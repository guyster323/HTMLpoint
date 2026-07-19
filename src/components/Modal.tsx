import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  initialFocusRef?: RefObject<HTMLElement>;
  onEscape: () => void;
  children?: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function Modal({
  open,
  title,
  description,
  initialFocusRef,
  onEscape,
  children
}: ModalProps): JSX.Element | null {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onEscapeRef = useRef(onEscape);
  const titleId = useId();
  const descriptionId = useId();
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = overlayRef.current;
    const backgroundElements = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== overlay
    );
    const backgroundState = backgroundElements.map((element) => ({
      element,
      inert: Boolean(element.inert),
      ariaHidden: element.getAttribute('aria-hidden')
    }));
    backgroundElements.forEach((element) => {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    });

    const dialog = dialogRef.current;
    if (dialog) {
      const requestedFocus = initialFocusRef?.current;
      const focusTarget =
        requestedFocus && dialog.contains(requestedFocus)
          ? requestedFocus
          : getFocusableElements(dialog)[0] ?? dialog;
      focusTarget.focus();
    }

    return () => {
      backgroundState.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) {
          element.removeAttribute('aria-hidden');
        } else {
          element.setAttribute('aria-hidden', ariaHidden);
        }
      });
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [initialFocusRef, open]);

  if (!open) {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscapeRef.current();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }

    const dialog = dialogRef.current;
    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div ref={overlayRef} className="plan-modal">
      <div
        ref={dialogRef}
        className="plan-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="plan-head modal-heading">
          <div>
            <strong id={titleId}>{title}</strong>
            {description ? <span id={descriptionId}>{description}</span> : null}
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true'
  );
}
