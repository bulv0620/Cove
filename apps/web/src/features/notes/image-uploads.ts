/**
 * Paste/drop image uploads for notes (NOTE-FR-012/NOTE-FR-013): every upload
 * goes through the existing image hosting API with an explicit publish
 * request, and the only address ever handed back for the note body is a
 * confirmed same-origin `/image/{publicId}` URL — never `blob:`, `data:`,
 * local file paths or SMB paths. Image lifecycle stays with the Images page
 * (NOTE-FR-014): removing a reference here never touches the asset.
 */
import type { HostedImage } from '@cove/shared';
import { imagesApi, uploadImage } from '@/features/images/api';

export const NOTE_IMAGE_PATTERN = /\.(jpe?g|png|webp|gif|avif)$/i;

export function isSupportedImage(file: File): boolean {
  return NOTE_IMAGE_PATTERN.test(file.name) && file.size > 0;
}

/** `photo.png` → `photo`; falls back to the raw name when it has no suffix. */
export function imageAltText(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  return (withoutExtension || fileName).replace(/[\\[\]]/g, '\\$&');
}

export interface UploadImageDeps {
  createUpload?: typeof imagesApi.createUpload;
  uploadFile?: typeof uploadImage;
  cancelUpload?: typeof imagesApi.cancelUpload;
  uuid?: () => string;
}

export interface RunImageUploadOptions {
  onProgress: (ratio: number) => void;
  signal: AbortSignal;
}

export interface NoteImageUploadResult {
  url: string;
  image: HostedImage;
}

export interface NoteImageUpload {
  run: (options: RunImageUploadOptions) => Promise<NoteImageUploadResult>;
}

/**
 * One uploadable file. The publish request is explicit and unconditional for
 * notes (NOTE-NFR-008); if the hosting service does not confirm a public
 * grant, the upload fails instead of inserting an unconfirmed address.
 */
export function createNoteImageUpload(file: File, deps: UploadImageDeps = {}): NoteImageUpload {
  const createUpload = deps.createUpload ?? imagesApi.createUpload;
  const uploadFile = deps.uploadFile ?? uploadImage;
  const cancelUpload = deps.cancelUpload ?? imagesApi.cancelUpload;
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  return {
    async run({ onProgress, signal }) {
      const operation = await createUpload(file.name, String(file.size), uuid(), true);
      let cancelled = false;
      try {
        if (signal.aborted) {
          cancelled = true;
          await cancelUpload(operation.id).catch(() => undefined);
          const failure = new Error('TRANSFER_INTERRUPTED');
          (failure as Error & { code?: string }).code = 'TRANSFER_INTERRUPTED';
          throw failure;
        }
        const image = await uploadFile(
          operation.id,
          file,
          (loaded) => onProgress(Math.min(1, loaded / Math.max(1, file.size))),
          signal,
        );
        const publicUrl = image.publicUrl;
        if (
          image.state !== 'PUBLIC' ||
          !publicUrl ||
          !/^\/image\/[A-Za-z0-9_-]{43}$/.test(publicUrl)
        ) {
          const failure = new Error(image.errorCode ?? 'FILES_FORBIDDEN');
          (failure as Error & { code?: string }).code = image.errorCode ?? 'FILES_FORBIDDEN';
          throw failure;
        }
        return { url: publicUrl, image };
      } catch (error) {
        // A user abort must release the pending operation server-side as well.
        if (signal.aborted && !cancelled) void cancelUpload(operation.id).catch(() => undefined);
        throw error;
      }
    },
  };
}
