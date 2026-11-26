import { createHash, randomUUID } from 'node:crypto';
import { platformHelpTopics } from '@/agent/platform-guide';
import type { UploadedListingImage } from '@/agent/marketplace/listing-image-storage';
import { recordModelReview } from '@/lib/admin/model-review';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import type { AuthSession } from '@/lib/auth/session';
import { chatServiceUnavailableMessage } from '@/lib/chat-response-safety';
import { draftImageSource } from './draft-memory';
import { hamadCapabilities as capabilities, structuredWriteResultSchema } from './hamad-capabilities';
import { composeHamadReply, inferHamadDraftCategory, planHamadTurn, reconsiderHamadDraftPlan, verifyHamadReply, verifyHamadWrite, type HamadPlan } from './hamad-structured-model';
import { hamadDraftTtlMs, openHamadState, sealHamadState, type HamadDraftAction, type HamadIntakeFact, type HamadStructuredState } from './hamad-structured-state';

type History = { role: 'user' | 'assistant'; text: string; id?: string };
type Run = {
  session: AuthSession;
  history: History[];
  request: string;
  requestKey?: string;
  conversationId: string | null;
  checkpoint?: unknown;
  draftCards?: boolean;
  draftAction?: HamadDraftAction;
  validationMessage?: string;
  creationEnabled: boolean;
  creationIntake?: { text: string; id?: string };
  reset: boolean;
  currentImages: UploadedListingImage[];
  imageSourceId?: string;
  retainedImages: (source: NonNullable<HamadStructuredState['image']>) => UploadedListingImage[];
  signal: AbortSignal;
};
type Draft = NonNullable<Awaited<ReturnType<typeof capabilities.get_draft.run>>>;
type Card = Pick<Draft['data'], 'title' | 'modified' | 'price' | 'imageCount'> & { thumbnail?: string };
type Preview = Card & Pick<Draft['data'], 'description' | 'city'>;
export type HamadDraftUi = {
  active: { title: string; expires: number } | null;
  page?: { key: string; cards: Card[]; hasNext: boolean; refreshed?: true };
  preview?: Preview;
};
type Reply = { text: string; hamadDraftMemory?: string; creationChoice?: boolean; hamadDraftUi?: HamadDraftUi;
  sections?: { text: string; preview?: { url: string; mediaType: 'image/webp' } }[] };

const day = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'short', timeZone: 'Asia/Riyadh' });
const unavailable = 'تعذّر التحقق من التفاصيل الآن. جرّب مرة أخرى بعد قليل.';
const draftNotSaved = 'ما حُفظت المسودة بعد.';
const mutationActions = new Set<HamadPlan['action']>(['create', 'update', 'attach']);

function draftCard({ data, preview }: Draft): Card {
  return { title: data.title || 'مسودة', modified: data.modified, price: data.price,
    imageCount: data.imageCount, thumbnail: preview?.url };
}

function draftPreview(draft: Draft): Preview {
  return { ...draftCard(draft), description: draft.data.description, city: draft.data.city };
}

function pageKey({ offset, rosterHash }: NonNullable<HamadStructuredState['page']>) {
  return rosterHash + ':' + offset;
}

function hasExactQuote(text: string, quote: string | undefined) {
  return Boolean(quote && text.includes(quote));
}

function decimalFromQuote(value: string) {
  const normalized = [...value].map((char) => {
    const code = char.charCodeAt(0);
    if (code >= 0x660 && code <= 0x669) return String(code - 0x660);
    if (code >= 0x6f0 && code <= 0x6f9) return String(code - 0x6f0);
    return char;
  }).join('').replaceAll('٫', '.').replaceAll('٬', ',');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/u.test(normalized)) return undefined;
  return Number(normalized.replaceAll(',', ''));
}

function draftFields(details: HamadPlan['details']): [string, HamadIntakeFact['value']][] {
  const { attributes, ...fields } = details ?? {};
  return [
    ...Object.entries(fields).flatMap(([key, value]): [string, HamadIntakeFact['value']][] => value == null ? [] : [[key, value]]),
    ...Object.entries(attributes ?? {}).map(([key, value]): [string, HamadIntakeFact['value']] => ['attributes.' + key, value]),
  ];
}

function supportedQuote(field: string, value: HamadIntakeFact['value'], quote: string | undefined) {
  return Boolean(quote && (field !== 'price' || typeof value !== 'number' || decimalFromQuote(quote) === value));
}

function rememberIntake(plan: HamadPlan, texts: readonly string[], retained: readonly HamadIntakeFact[]) {
  return draftFields(plan.details).flatMap(([field, value]) => {
    const quote = plan.evidence?.[field];
    if (!quote || !supportedQuote(field, value, quote)) return [];
    const source = texts.find((text) => hasExactQuote(text, quote));
    if (source) return [{ field, value, quote, source: source === quote ? undefined : source }];
    const remembered = retained.find((fact) => fact.field === field && fact.value === value && fact.quote === quote);
    return remembered ? [remembered] : [];
  });
}

function retainVerifiedFacts(facts: HamadIntakeFact[], previous: readonly HamadIntakeFact[]) {
  return [...facts, ...previous.filter(({ field }) => !facts.some(fact => fact.field === field))];
}

function includeRememberedFields(plan: HamadPlan, retained: readonly HamadIntakeFact[], request: string): HamadPlan {
  if (!retained.length) return plan;
  const fields = new Map(retained.map(({ field, value, quote }) => [field, { value, quote: quote as string | undefined }]));
  for (const [field, value] of draftFields(plan.details)) {
    const quote = plan.evidence?.[field];
    if (!fields.has(field) || hasExactQuote(request, quote)) {
      fields.delete(field);
      fields.set(field, { value, quote });
    }
  }
  const detailEntries = [...fields].filter(([field]) => !field.startsWith('attributes.'));
  const attributes = [...fields].filter(([field]) => field.startsWith('attributes.')).slice(-16);
  return {
    ...plan,
    details: {
      ...Object.fromEntries(detailEntries.map(([field, { value }]) => [field, value])),
      ...(attributes.length ? { attributes: Object.fromEntries(attributes.map(([field, { value }]) => [field.slice('attributes.'.length), value])) } : {}),
    },
    evidence: Object.fromEntries([...detailEntries, ...attributes].flatMap(([field, { quote }]) => quote ? [[field, quote]] : [])),
  };
}

const clearIntake = { collecting: undefined, intake: undefined, intakeStartText: undefined };

export async function runStructuredHamadTurn(input: Run): Promise<Reply> {
  const context = { trace: randomUUID(), signal: AbortSignal.any([input.signal, AbortSignal.timeout(55_000)]) };
  let state = input.reset ? {} : openHamadState(input.checkpoint, input.session, input.conversationId);
  const collectingStart = state.collecting ? input.history.findIndex(({ id }) => id === state.collecting) : -1;
  const untaggedHistory = input.history.map(({ role, text }) => ({ role, text }));
  let draftHistory = input.creationIntake?.text
    ? [{ role: 'user' as const, text: input.creationIntake.text }]
    : collectingStart < 0 ? [] : untaggedHistory.slice(collectingStart);
  if (collectingStart < 0 && state.intakeStartText) {
    draftHistory.unshift({ role: 'user', text: state.intakeStartText });
  }
  const keepDraftIntake = () => {
    state = { ...state, collecting: state.collecting ?? input.creationIntake?.id ?? input.requestKey,
      intakeStartText: state.intakeStartText ?? (input.creationIntake?.text || input.request.slice(0, 1_200)),
      focus: undefined, focusTitle: undefined, page: undefined };
  };
  // The customer's explicit creation choice starts intake even if the planner asks a question.
  if (input.creationEnabled && input.creationIntake) keepDraftIntake();
  const currentImage = draftImageSource(input.imageSourceId ?? input.requestKey, input.currentImages);
  if (currentImage) state = { ...state, image: currentImage };
  const capabilityContext = { ...context, session: input.session, images: input.currentImages,
    sourceId: currentImage?.sourceId };
  const answer = (text: string, options: Pick<Reply, 'creationChoice' | 'sections'> = {},
    view: Omit<HamadDraftUi, 'active'> = {}): Reply => {
    const now = Date.now();
    const hamadDraftMemory = sealHamadState(state, input.session, input.conversationId);
    return { text, ...options, hamadDraftMemory,
      ...(input.draftCards && { hamadDraftUi: { ...view, active: hamadDraftMemory && state.focus && state.focusTitle
        ? { title: state.focusTitle, expires: now + hamadDraftTtlMs } : null } }) };
  };
  async function groundedReply(facts: unknown, fallback = unavailable, approvedPaths: readonly string[] = []) {
    try {
      const text = await composeHamadReply({ request: input.request, facts }, context);
      const links = [...text.matchAll(/\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/gu)].map((match) => match[1] ?? match[2]);
      if (text && links.every((link) => approvedPaths.includes(link))
        && await verifyHamadReply({ request: input.request, facts, text }, context)) return text;
    } catch {
      // Once a write is saved, a wording failure must not turn it into another write.
    }
    return fallback;
  }

  async function showPage(offset: number, compareHash?: string, updated = false) {
    let page = await capabilities.list_my_drafts.run(capabilityContext, { offset });
    if (compareHash && compareHash !== page.rosterHash) {
      page = await capabilities.list_my_drafts.run(capabilityContext, { offset: 0 });
      updated = true;
    }
    state = { ...state, ...(page.entries.length ? clearIntake : {}), focus: undefined, focusTitle: undefined,
      page: page.entries.length ? { offset: page.offset, rosterHash: page.rosterHash, hasNext: page.hasNext,
        entries: page.entries.map(({ ref }) => ref) } : undefined };
    if (!state.page) return answer(input.draftAction ? 'ما عندك مسودات حاليًا. تقدر تطلب مني أجهّز إعلان جديد.'
      : await groundedReply({ status: 'no_drafts', instruction: 'Invite a new draft if wanted.' }));
    const choices = page.entries.map(({ data, preview }, index) => {
      const modified = Date.parse(data.modified);
      const date = Number.isFinite(modified) ? day.format(modified) : '';
      return { text: [String(index + 1) + '. ' + (data.title || 'مسودة'), 'مسودة', date, 'عدد الصور ' + data.imageCount]
        .filter(Boolean).join(' · '), preview };
    });
    if (page.hasNext) choices.push({ text: 'الصفحة التالية متاحة.', preview: undefined });
    const instruction = updated ? 'تحدّثت القائمة. اختر المسودة من القائمة الحالية.' : '';
    if (input.draftCards) {
      return answer([instruction, ...choices.map(({ text }) => text)].filter(Boolean).join('\n'), {}, {
        page: { key: pageKey(state.page), cards: page.entries.map(draftCard), hasNext: page.hasNext,
          ...(updated && { refreshed: true }) },
      });
    }
    return answer(choices.map(({ text }) => text).join('\n'), choices.some(({ preview }) => preview) ? { sections: choices } : {});
  }

  async function selectDraft(choice: number, shownPage?: string) {
    const page = state.page;
    const chosen = page?.entries[choice - 1];
    if (!page || !chosen || (shownPage && shownPage !== pageKey(page))) return showPage(0, undefined, true);
    const currentPage = await capabilities.list_my_drafts.run(capabilityContext, { offset: page.offset });
    if (currentPage.rosterHash !== page.rosterHash) return showPage(0, undefined, true);
    const current = await capabilities.get_draft.run(capabilityContext, chosen);
    if (!current || current.ref.version !== chosen.version) return showPage(0, undefined, true);
    state = { ...state, ...clearIntake, focus: current.ref, focusTitle: current.data.title || 'مسودة', page: undefined,
      ...(shownPage && { image: undefined }) };
    const text = shownPage ? 'تم اختيار المسودة. اكتب التعديل المطلوب أو أرفق الصور.' :
      await groundedReply({ status: 'selected', draft: current.data });
    return answer([current.data.title, text].filter(Boolean).join('\n'), {}, { preview: draftPreview(current) });
  }

  let plan: HamadPlan;
  let stage = 'plan';
  try {
    if (input.validationMessage) return answer(input.validationMessage);
    if (input.draftAction) {
      stage = 'draft_picker';
      if (input.draftAction.type === 'list') return await showPage(0);
      if (input.draftAction.type === 'select') return await selectDraft(input.draftAction.choice, input.draftAction.page);
      const page = state.page;
      return page?.hasNext && input.draftAction.page === pageKey(page)
        ? await showPage(page.offset + page.entries.length, page.rosterHash) : await showPage(0, undefined, true);
    }
    // A conversation resumed from a checkpoint issued before cards may still have a selected draft.
    if (input.draftCards && state.focus && !state.focusTitle) {
      stage = 'draft_read';
      const selected = await capabilities.get_draft.run(capabilityContext, state.focus);
      if (!selected || selected.ref.version !== state.focus.version) return await showPage(0, undefined, true);
      state = { ...state, focusTitle: selected.data.title || 'مسودة' };
    }
    stage = 'plan';
    const planInput = {
      request: input.request, history: untaggedHistory, creationEnabled: input.creationEnabled,
      hasImages: input.currentImages.length > 0,
      imageCount: input.currentImages.length,
      canRequestRetainedImages: Boolean(state.image && !currentImage),
      rememberedDraft: state.intake?.map(({ field, value, quote }) => ({ field, value, quote })),
      conversation: { collecting: Boolean(state.collecting || input.creationIntake?.text), hasConfirmedDraft: Boolean(state.focus),
        selectedDraftTitle: state.focusTitle,
        displayedChoices: state.page?.entries.length ?? 0, hasNext: state.page?.hasNext === true },
      authorizedTopics: platformHelpTopics,
    };
    plan = await planHamadTurn(planInput, context);
    if (plan.advisory && input.request) {
      await recordModelReview({ subject: 'message', subjectId: 'assistant:' + input.session.user.id,
        userId: input.session.user.id, text: input.request, assessment: plan.advisory })
        .catch(() => console.warn('[hamad_structured] advisory_review_unavailable'));
    }
    if (plan.action === 'clarify' && input.creationEnabled && !state.focus && !state.page &&
      input.requestKey && input.conversationId && input.request.trim()) {
      stage = 'draft_replan';
      const recovered = await reconsiderHamadDraftPlan({
        ...planInput, history: draftHistory,
      }, context).catch(() => null);
      context.signal.throwIfAborted();
      if (recovered?.action === 'create' && recovered.confirmWrite === true &&
        hasExactQuote(input.request, recovered.reference)) {
        plan = recovered;
      }
    }
    if (process.env.SMARTSTORE_DEEPSEEK_METRICS === '1') {
      console.info(JSON.stringify({ event: 'hamad_structured_plan', trace: context.trace, action: plan.action }));
    }
    stage = plan.action;
    const startsNewDraft = plan.action === 'create' && input.creationEnabled && !input.creationIntake && state.collecting
      && hasExactQuote(input.request, plan.newDraft);
    if (startsNewDraft) {
      state = { ...state, ...clearIntake, image: currentImage, collecting: input.requestKey,
        intakeStartText: input.request.slice(0, 1_200) };
      draftHistory = [];
    }
    const collecting = !startsNewDraft && Boolean(state.collecting || input.creationIntake?.text);
    const retained = state.intake ?? [];
    const intakeTexts = [input.request,
      ...draftHistory.filter(({ role }) => role === 'user').map(({ text }) => text).reverse()];
    if (plan.action === 'list') return await showPage(0);
    if (plan.action === 'next') return state.page?.hasNext
      ? await showPage(state.page.offset + state.page.entries.length, state.page.rosterHash) : await showPage(0);

    if (plan.action === 'select') {
      if (!plan.choice || !hasExactQuote(input.request, plan.reference)) return await showPage(0);
      return await selectDraft(plan.choice);
    }
    if (plan.action === 'view') {
      if (!state.focus) return await showPage(0);
      const current = await capabilities.get_draft.run(capabilityContext, state.focus);
      if (!current || current.ref.version !== state.focus.version) return await showPage(0);
      return answer(await groundedReply({ status: 'read', draft: current.data }), {}, { preview: draftPreview(current) });
    }
    if (plan.action === 'help') {
      const sources = await Promise.all([...new Set(plan.topics ?? [])].map((topic) =>
        capabilities.get_platform_info.run(capabilityContext, { topic })));
      const paths = sources.flatMap(({ content }) => {
        const source = (content as { source?: { path?: unknown } }).source;
        return typeof source?.path === 'string' && source.path.startsWith('/') && !source.path.startsWith('//') ? [source.path] : [];
      });
      return answer(await groundedReply({ sources, status: sources.length ? 'documented' : 'undocumented' },
        'ما عندي معلومة موثقة أقدر أؤكدها في هذا السؤال.', paths));
    }
    if (plan.action === 'categories') {
      const categories = await capabilities.get_categories.run(capabilityContext, {});
      return answer(await groundedReply({ categories }));
    }
    if (!mutationActions.has(plan.action) && plan.action !== 'inspect') {
      if (plan.action === 'outside') state = { ...state, ...clearIntake };
      if (plan.action === 'clarify' && input.creationEnabled && !state.focus && !state.page) {
        if (plan.details) {
          const facts = rememberIntake(includeRememberedFields(plan, retained, input.request), intakeTexts, retained);
          if (state.collecting || facts.some(({ field }) => field === 'title' || field === 'description')) {
            keepDraftIntake();
            state.intake = retainVerifiedFacts(facts, retained);
          }
        }
        const hasProduct = state.intake?.some(({ field }) => field === 'title' || field === 'description');
        const question = hasProduct ? 'تبغاني أحفظ المسودة بالتفاصيل اللي ذكرتها؟'
          : 'وش الإعلان اللي تبي أجهّز له مسودة؟';
        return answer(draftNotSaved + ' ' + question);
      }
      return answer(await groundedReply({ status: plan.action, suggestion: plan.reply,
        ...(state.collecting && { knownDraftDetails: state.intake?.map(({ field, value }) => ({ field, value })) }),
        capabilities: ['draft preparation', 'platform help'] }));
    }

    if (plan.action !== 'inspect' && !input.creationEnabled) {
      return answer(await groundedReply({ status: 'creation_choice', modes: ['الإنشاء مع حمد', 'الإنشاء اليدوي'] },
        'اختر طريقة إنشاء الإعلان للمتابعة.'), { creationChoice: true });
    }

    let images = input.currentImages;
    let imageSource = currentImage?.sourceId;
    if (!images.length && plan.useRetained && state.image && hasExactQuote(input.request, plan.reference)) {
      const retained = input.retainedImages(state.image);
      if (draftImageSource(state.image.sourceId, retained)?.digest === state.image.digest) {
        images = retained;
        imageSource = state.image.sourceId;
      }
    }
    const mediaContext = { ...capabilityContext, images, sourceId: imageSource };
    const indexes = [...new Set(plan.photos ?? (plan.action === 'inspect' && images.length ? [1] : []))].map((index) => index - 1);
    if (indexes.some((index) => !images[index]) || (indexes.length > 0 && !imageSource)) {
      if (plan.action === 'create') return answer(draftNotSaved + ' الصور المطلوبة غير متاحة. تقدر تعيد إرفاقها أو تطلب الحفظ بدونها.');
      return answer(await groundedReply({ status: 'image_unavailable' }));
    }
    if (plan.action === 'inspect') {
      if (!indexes.length) return answer(await groundedReply({ status: 'image_required' }));
      const observed = await capabilities.analyze_image.run(mediaContext, { photos: indexes });
      return answer(await groundedReply({ status: observed.status, tentativeObservations: observed.observations }));
    }

    const creating = plan.action === 'create';
    if (creating) plan = includeRememberedFields(plan, retained, input.request);
    if (creating && !plan.details?.category && (plan.details?.title || plan.details?.description)) {
      stage = 'draft_category';
      const catalog = await capabilities.get_categories.run(capabilityContext, {});
      const inferred = await inferHamadDraftCategory({
        request: input.request, history: draftHistory, details: plan.details, catalog,
      }, context).catch(() => null);
      context.signal.throwIfAborted();
      if (inferred) {
        plan = { ...plan, details: { ...plan.details, ...inferred.details },
          evidence: { ...plan.evidence, ...inferred.evidence } };
      }
    }
    const details = plan.details ?? {};
    const draftFacts = creating ? rememberIntake(plan, intakeTexts, retained) : [];
    if (creating && (!details.category || !(details.title?.trim() || details.description?.trim()))) {
      const missingProduct = !details.title?.trim() && !details.description?.trim();
      keepDraftIntake();
      state.intake = retainVerifiedFacts(draftFacts, retained);
      // A photo can inform the next question, yet only customer-confirmed facts can be saved.
      const observations = images.length && imageSource
        ? await capabilities.analyze_image.run(mediaContext, { photos: indexes.length ? indexes : [0] }) : undefined;
      const visibleProduct = observations?.observations[0]?.visibleProduct;
      const question = missingProduct ? 'وش المنتج اللي تبي تجهّز له إعلان؟' : 'وش تصنيف المنتج اللي تبي تعلن عنه؟';
      const observation = visibleProduct ? ' يبدو أن الصورة تعرض «' + visibleProduct + '».' : '';
      return answer(draftNotSaved + observation + ' ' + question);
    }
    if (!creating && !state.focus) return await showPage(0);
    const confirmedRequest = plan.confirmWrite === true && hasExactQuote(input.request, plan.reference);
    const unverified = creating
      ? draftFields(details).filter(([field]) => !draftFacts.some((fact) => fact.field === field)).map(([field]) => field)
      : draftFields(details).filter(([field, value]) => {
        const quote = plan.evidence?.[field];
        return !supportedQuote(field, value, quote) || !hasExactQuote(input.request, quote);
      }).map(([field]) => field);
    if (!input.requestKey || !input.conversationId || !confirmedRequest || unverified.length ||
      (plan.action === 'update' && !Object.keys(details).length) || (plan.action === 'attach' && !indexes.length)) {
      if (creating && (confirmedRequest || state.collecting)) {
        keepDraftIntake();
        state.intake = retainVerifiedFacts(draftFacts, retained);
      }
      const priceQuestion = unverified.length === 1 && unverified[0] === 'price';
      if (creating) {
        return answer(draftNotSaved + ' ' + (priceQuestion ? 'كم السعر بالأرقام؟'
          : 'أكّد المعلومات المطلوبة واطلب حفظها كمسودة.'));
      }
      return answer(await groundedReply({ status: 'write_needs_clarification', unverifiedFields: unverified,
        suggestion: plan.reply, ...(priceQuestion && { instruction: 'Ask only for the price in digits.' }) },
      priceQuestion ? 'كم السعر بالأرقام؟' : unavailable));
    }
    if (creating) {
      keepDraftIntake();
      state.intake = draftFacts;
    }

    const key = createHash('sha256').update(JSON.stringify([
      input.session.user.sessionVersion ?? 0, input.session.issuedAt, input.conversationId, input.requestKey,
    ])).digest('hex');
    stage = 'write_reservation';
    const lease = await reserveIdempotencyKey(new Request('http://localhost/api/chat', { headers: { 'idempotency-key': key } }),
      { namespace: 'hamad_structured_write', actorKey: input.session.user.id });
    if (!lease) return answer(unavailable);
    if (lease.response?.status === 409) return answer('الطلب نفسه قيد المعالجة. جرّب بعد قليل.');
    let result: ReturnType<typeof structuredWriteResultSchema.parse>;
    if (lease.response) {
      result = structuredWriteResultSchema.parse(await lease.response.json());
    } else {
      let writeStarted = false;
      let draftLease: Awaited<ReturnType<typeof reserveIdempotencyKey>> = null;
      try {
        const target = !creating && state.focus ? await capabilities.get_draft.run(capabilityContext, state.focus) : null;
        if (!creating && (!target || target.ref.version !== state.focus?.version)) {
          await lease.abandon();
          return await showPage(0);
        }
        if (target) {
          const lockKey = createHash('sha256').update(JSON.stringify([input.session.user.id, target.ref.id])).digest('hex');
          draftLease = await reserveIdempotencyKey(new Request('http://localhost/api/chat', { headers: { 'idempotency-key': lockKey } }),
            { namespace: 'hamad_structured_draft_lock', actorKey: input.session.user.id });
          if (!draftLease || draftLease.response) {
            await lease.abandon();
            return answer('يُنفّذ حمد طلبًا آخر على هذه المسودة الآن. جرّب بعد قليل.');
          }
        }
        stage = 'write_check';
        const approved = await verifyHamadWrite({
          request: input.request, history: creating ? draftHistory : [],
          ...(creating && { customerFieldSources: draftFacts.flatMap(({ field, quote, source }) =>
            intakeTexts.includes(source ?? quote) ? [] : [{ field, quote, text: source ?? quote }]) }),
          action: plan.action, proposedDetails: details, evidence: plan.evidence, reference: plan.reference,
          confirmedDraft: target?.data, collecting, photoCount: indexes.length,
        }, context);
        if (!approved) {
          await lease.abandon();
          if (creating) return answer(draftNotSaved + ' تعذّر التحقق من طلب الحفظ. أكّد إنك تبي حفظ الإعلان كمسودة.');
          return answer(await groundedReply({ status: 'write_not_authorized', suggestion: plan.reply }));
        }
        writeStarted = true;
        stage = 'draft_save';
        const writeContext = { ...mediaContext, operationKey: lease.operationKey };
        result = creating && details.category ? await capabilities.create_draft.run(writeContext, {
          details: { ...details, category: details.category }, photos: indexes,
        }) : plan.action === 'update' && target ? await capabilities.update_draft.run(writeContext, {
          focus: target.ref, details, evidence: plan.evidence ?? {},
        }) : await capabilities.attach_draft_images.run(writeContext, { focus: target!.ref, photos: indexes });
        if (plan.action === 'update' && indexes.length && result.focus && result.status === 'updated') {
          // The fields may already be saved when image processing fails. Keep their receipt on retries.
          try {
            const photos = await capabilities.attach_draft_images.run(writeContext, { focus: result.focus, photos: indexes });
            result = { status: photos.status === 'draft_changed' ? 'fields_saved_photos_unconfirmed' : photos.status,
              focus: photos.focus ?? result.focus,
              receipts: [...result.receipts, ...photos.receipts] };
          } catch (error) {
            console.warn('[hamad_structured] followup_photos_unconfirmed', error instanceof Error ? error.name : 'UnknownError');
            result = { ...result, status: 'fields_saved_photos_unconfirmed' };
          }
        }
        stage = 'write_receipt';
        try {
          await lease.complete(result);
        } catch (error) {
          if (!creating || !result.receipts.some(({ kind }) => kind === 'saved' || kind === 'replayed')) throw error;
          // The draft has committed. Keep the reservation intact and report
          // the actual save even if the receipt cannot be cached for replay.
          console.warn(JSON.stringify({ event: 'hamad_draft_receipt_unavailable', trace: context.trace,
            operation: lease.operationKey.slice(0, 16) }));
        }
      } catch (error) {
        // An unknown outcome after dispatch keeps its operation reservation. Later retries use the same identity.
        if (!writeStarted) await lease.abandon();
        throw error;
      } finally {
        if (draftLease && !draftLease.response) {
          await draftLease.abandon().catch(() => console.warn('[hamad_structured] draft_lease_release_failed'));
        }
      }
    }
    if (result.status === 'draft_changed') return await showPage(0);
    if (result.focus) state = { ...state, ...clearIntake, focus: result.focus,
      focusTitle: result.receipts.at(-1)?.title || state.focusTitle || 'مسودة', page: undefined };
    const { status, receipts } = result;
    const saved = receipts.some(({ kind }) => kind === 'saved' || kind === 'updated' || kind === 'replayed');
    if (creating && !receipts.length) {
      const reason = status === 'limit_reached' ? ' وصلت للحد المسموح من الإعلانات.' : '';
      return answer(draftNotSaved + reason);
    }
    const photos = receipts.find(({ kind }) => kind === 'photos')?.facts;
    const requested = typeof photos?.requested === 'number' ? photos.requested : saved ? indexes.length : 0;
    const attached = typeof photos?.attached === 'number' ? photos.attached : 0;
    const savedText = receipts.some(({ kind }) => kind === 'updated') ? 'حُدّثت المسودة.' : 'حُفظت المسودة.';
    const partialSave = requested > attached;
    const fallback = [saved ? savedText : '', requested > 0 && attached === requested ? `عدد الصور المحفوظة ${attached}.` : '',
      'راجع التفاصيل من [إعلاناتي](/account/listings).'].filter(Boolean).join(' ');
    const current = input.draftCards && result.focus
      ? await capabilities.get_draft.run(capabilityContext, result.focus).catch(() => null) : null;
    const view = current && current.ref.version === result.focus?.version ? { preview: draftPreview(current) } : {};
    if (status === 'fields_saved_photos_unconfirmed') {
      return answer(savedText + ' تعذّر تأكيد إرفاق الصور. افحصها في المسودة قبل إعادة المحاولة.', {}, view);
    }
    if (partialSave) {
      const resultText = `حُفظت ${attached} من أصل ${requested} صورة. يمكنك إعادة إرفاق الصور المتبقية.`;
      return answer([saved ? savedText : '', resultText].filter(Boolean).join(' '), {}, view);
    }
    const pendingPhotoSource = state.image?.sourceId;
    const photosInIntake = collectingStart >= 0 && pendingPhotoSource
      && input.history.slice(collectingStart).some(({ id }) => id === pendingPhotoSource);
    if (creating && saved && !requested && (currentImage || photosInIntake || (plan.useRetained && pendingPhotoSource))) {
      return answer(savedText + ' لم تُرفق الصور المرسلة. تقدر تضيفها من [إعلاناتي](/account/listings).', {}, view);
    }
    return answer(await groundedReply({ status, receipts }, fallback, ['/account/listings']), {}, view);
  } catch (error) {
    if (!input.signal.aborted) {
      const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
        && /^P\d{4}$/u.test(error.code) ? error.code : undefined;
      console.warn(JSON.stringify({ event: 'hamad_turn_failure', trace: context.trace, stage, code }));
    }
    return answer(chatServiceUnavailableMessage);
  }
}
