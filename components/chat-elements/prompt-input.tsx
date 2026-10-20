"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  InputGroup,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  convertAttachmentBlobToDataUrl,
  isProbablyImageFile,
} from "@/lib/client-image-normalization";
import { cn } from "@/lib/utils";
import type { FileUIPart } from "ai";
import { nanoid } from "nanoid";
import {
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type ComponentProps,
  type CSSProperties,
  createContext,
  type FormEvent,
  type FormEventHandler,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ============================================================================
// Attachment Context & Types
// ============================================================================

export type AttachmentsContext = {
  files: PromptInputAttachment[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

type PromptInputAttachment = FileUIPart & {
  id: string;
  file?: File;
  preparation?: Promise<{ mediaType: string; url: string } | null>;
};

function createPromptInputAttachments(files: File[], maxConcurrency = 2) {
  const workerCount = Math.min(Math.max(1, maxConcurrency), files.length || 1);
  const workers = Array.from({ length: workerCount }, () =>
    Promise.resolve()
  );

  return files.map((file, index): PromptInputAttachment => {
    const workerIndex = index % workerCount;
    const preparation = workers[workerIndex]
      .then(() => convertAttachmentBlobToDataUrl(file, file.type, file.name))
      .catch(() => null);
    workers[workerIndex] = preparation.then(() => undefined);

    return {
      id: nanoid(),
      type: "file",
      file,
      preparation,
      url: URL.createObjectURL(file),
      mediaType: file.type,
      filename: file.name,
    };
  });
}

// ============================================================================
// Component Context & Hooks
// ============================================================================

const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
  const context = useContext(LocalAttachmentsContext);
  if (!context) {
    throw new Error(
      "usePromptInputAttachments must be used within a PromptInput"
    );
  }
  return context;
};

export type PromptInputMessage = Parameters<UseChatHelpers<never>["sendMessage"]>[0];

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  inputGroupClassName?: string;
  inputGroupStyle?: CSSProperties;
  accept?: string; // e.g., "image/*" or leave undefined for any
  multiple?: boolean;
  allowAttachments?: boolean;
  // When true, accepts drops anywhere on document. Default false (opt-in).
  globalDrop?: boolean;
  // Render a hidden input with given name and keep it in sync for native form posts. Default false.
  syncHiddenInput?: boolean;
  // Minimal constraints
  maxFiles?: number;
  maxFileSize?: number; // bytes
  onError?: (err: {
    code: "max_files" | "max_file_size" | "accept";
    message: string;
  }) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  inputGroupClassName,
  inputGroupStyle,
  accept,
  multiple,
  allowAttachments = false,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  // Refs
  const inputRef = useRef<HTMLInputElement | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Find nearest form to scope drag & drop
  useEffect(() => {
    const root = anchorRef.current?.closest("form");
    if (root instanceof HTMLFormElement) {
      formRef.current = root;
    }
  }, []);

  // ----- Local attachments
  const [items, setItems] = useState<PromptInputAttachment[]>([]);
  const files = items;

  const openFileDialogLocal = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const matchesAccept = useCallback(
    (f: File) => {
      if (!allowAttachments) {
        return false;
      }

      if (!accept || accept.trim() === "") {
        return true;
      }

      return accept
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
        .some((acceptedType) => {
          if (acceptedType.endsWith("/*")) {
            if (acceptedType === "image/*") {
              return isProbablyImageFile(f, f.type, f.name);
            }

            return f.type
              .toLowerCase()
              .startsWith(acceptedType.slice(0, -1));
          }

          if (acceptedType.startsWith(".")) {
            return f.name.toLowerCase().endsWith(acceptedType);
          }

          return f.type.toLowerCase() === acceptedType;
        });
    },
    [accept, allowAttachments]
  );

  const addLocal = useCallback(
    (fileList: File[] | FileList) => {
      const incoming = Array.from(fileList);
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: "accept",
          message: "نوع الملفات المحددة غير مدعوم.",
        });
        return;
      }
      const withinSize = (f: File) =>
        maxFileSize ? f.size <= maxFileSize : true;
      const sized = accepted.filter(withinSize);
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: "max_file_size",
          message: "جميع الملفات تتجاوز الحجم المسموح.",
        });
        return;
      }

      setItems((prev) => {
        const capacity =
          typeof maxFiles === "number"
            ? Math.max(0, maxFiles - prev.length)
            : undefined;
        const capped =
          typeof capacity === "number" ? sized.slice(0, capacity) : sized;
        if (typeof capacity === "number" && sized.length > capacity) {
          onError?.({
            code: "max_files",
            message: "تجاوزت عدد الملفات المسموح؛ لم تتم إضافة بعض الملفات.",
          });
        }
        const next = createPromptInputAttachments(capped);
        return prev.concat(next);
      });
    },
    [matchesAccept, maxFiles, maxFileSize, onError]
  );

  const add = useCallback(
    (files: File[] | FileList) => {
      if (!allowAttachments) {
        return;
      }

      addLocal(files);
    },
    [addLocal, allowAttachments]
  );

  const remove = useCallback(
    (id: string) => {
      setItems((prev) => {
        const found = prev.find((file) => file.id === id);
        if (found?.url) {
          URL.revokeObjectURL(found.url);
        }
        return prev.filter((file) => file.id !== id);
      });
    },
    []
  );

  const clear = useCallback(() => {
    setItems((prev) => {
      for (const file of prev) {
        if (file.url) {
          URL.revokeObjectURL(file.url);
        }
      }
      return [];
    });
  }, []);

  const openFileDialog = useCallback(() => {
    if (!allowAttachments) {
      return;
    }

    openFileDialogLocal();
  }, [allowAttachments, openFileDialogLocal]);

  // Note: File input cannot be programmatically set for security reasons
  // The syncHiddenInput prop is no longer functional
  useEffect(() => {
    if (syncHiddenInput && inputRef.current && files.length === 0) {
      inputRef.current.value = "";
    }
  }, [files, syncHiddenInput]);

  // Attach drop handlers on nearest form and document (opt-in)
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);
    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [add]);

  useEffect(() => {
    if (!allowAttachments || !globalDrop) return;

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, allowAttachments, globalDrop]);

  useEffect(
    () => () => {
      for (const f of files) {
        if (f.url) URL.revokeObjectURL(f.url);
      }
    },
    [files]
  );

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    if (event.currentTarget.files) {
      add(event.currentTarget.files);
    }
  };

  const convertBlobUrlToDataUrl = async (
    url: string,
    mediaType?: string,
    fileName?: string
  ): Promise<{ mediaType: string; url: string }> => {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Attachment preview could not be read.");
    }

    const blob = await response.blob();
    return convertAttachmentBlobToDataUrl(blob, mediaType, fileName);
  };

  const ctx = useMemo<AttachmentsContext>(
    () => ({
      files: allowAttachments
        ? files.map((item) => ({ ...item, id: item.id }))
        : [],
      add,
      remove,
      clear,
      openFileDialog,
      fileInputRef: inputRef,
    }),
    [files, add, allowAttachments, remove, clear, openFileDialog]
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const text = (formData.get("message") as string) || "";

    // Reset form immediately after capturing text to avoid race condition
    // where user input during async blob conversion would be lost
    form.reset();

    // Convert attachments to data URLs before sending them to the chat API.
    Promise.all(
      (allowAttachments ? files : []).map(async (item) => {
        const filePart = {
          type: item.type,
          url: item.url,
          mediaType: item.mediaType,
          filename: item.filename,
        };

        if (item.file) {
          const convertedFile =
            (await item.preparation) ??
            (await convertAttachmentBlobToDataUrl(
              item.file,
              item.mediaType,
              item.filename
            ));

          return {
            ...filePart,
            ...convertedFile,
          };
        }

        if (filePart.url && filePart.url.startsWith("blob:")) {
          const convertedFile = await convertBlobUrlToDataUrl(
            filePart.url,
            filePart.mediaType,
            filePart.filename
          );

          return {
            ...filePart,
            ...convertedFile,
          };
        }
        return filePart;
      })
    ).then((convertedFiles: FileUIPart[]) => {
      try {
        const result = onSubmit({ text, files: convertedFiles } as PromptInputMessage, event);

        // Handle both sync and async onSubmit
        if (result instanceof Promise) {
          result
            .then(() => {
              clear();
            })
            .catch(() => {
              // Don't clear on error - user may want to retry
            });
        } else {
          // Sync function completed without throwing, clear attachments
          clear();
        }
      } catch {
        // Don't clear on error - user may want to retry
      }
    }).catch(() => {
      onError?.({
        code: "accept",
        message: "تعذر قراءة المرفق المحدد. أزله ثم أرفقه مجددًا.",
      });
    });
  };

  // Render with the local attachment context
  const inner = (
    <>
      <span aria-hidden="true" className="hidden" ref={anchorRef} />
      {allowAttachments && (
        <input
          accept={accept}
          aria-label="رفع الملفات"
          className="hidden"
          id="smartstore-chat-attachments"
          multiple={multiple}
          name="attachments"
          onChange={handleChange}
          ref={inputRef}
          title="رفع الملفات"
          type="file"
        />
      )}
      <form
        className={cn("w-full", className)}
        onSubmit={handleSubmit}
        {...props}
      >
        <InputGroup
          className={cn("overflow-hidden", inputGroupClassName)}
          style={inputGroupStyle}
        >
          {children}
        </InputGroup>
      </form>
    </>
  );

  return (
    <LocalAttachmentsContext.Provider value={ctx}>
      {inner}
    </LocalAttachmentsContext.Provider>
  );
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<
  typeof InputGroupTextarea
>;

export const PromptInputTextarea = ({
  onChange,
  className,
  placeholder = "اكتب طلبك هنا...",
  ...props
}: PromptInputTextareaProps) => {
  const attachments = usePromptInputAttachments();
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter") {
      if (isComposing || e.nativeEvent.isComposing) {
        return;
      }
      if (e.shiftKey) {
        return;
      }
      e.preventDefault();

      // Check if the submit button is disabled before submitting
      const form = e.currentTarget.form;
      const submitButton = form?.querySelector(
        'button[type="submit"]'
      ) as HTMLButtonElement | null;
      if (submitButton?.disabled) {
        return;
      }

      form?.requestSubmit();
    }

    // Remove last attachment when Backspace is pressed and textarea is empty
    if (
      e.key === "Backspace" &&
      e.currentTarget.value === "" &&
      attachments.files.length > 0
    ) {
      e.preventDefault();
      const lastAttachment = attachments.files.at(-1);
      if (lastAttachment) {
        attachments.remove(lastAttachment.id);
      }
    }
  };

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const items = event.clipboardData?.items;

    if (!items) {
      return;
    }

    const files: File[] = [];

    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      event.preventDefault();
      attachments.add(files);
    }
  };

  return (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-48 min-h-16", className)}
      name="message"
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      {...props}
      onChange={onChange}
    />
  );
};
