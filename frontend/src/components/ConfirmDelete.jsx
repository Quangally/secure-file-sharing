import React, { useEffect, useRef } from "react";

export default function ConfirmDelete({ file, onCancel, onConfirm }) {
  const cancelRef = useRef(null),
    dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    return () => previous?.isConnected && previous.focus();
  }, []);
  function keyboard(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
    if (event.key === "Tab") {
      const buttons = [...dialogRef.current.querySelectorAll("button")];
      const index = buttons.indexOf(document.activeElement);
      event.preventDefault();
      buttons[
        (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
      ]?.focus();
    }
  }
  return (
    <div className="ss-modal-backdrop">
      <section
        className="ss-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
        onKeyDown={keyboard}
        ref={dialogRef}
      >
        <div className="ss-danger-symbol" aria-hidden="true">
          !
        </div>
        <h2 id="delete-title">Xóa tệp này?</h2>
        <p className="ss-dialog-filename">{file.name}</p>
        <p id="delete-description">
          Tệp sẽ được gỡ khỏi kho và chặn các lượt tải mới. Người đã tải trước
          đó vẫn có thể giữ bản sao.
        </p>
        <div className="ss-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="ss-button secondary"
            onClick={onCancel}
          >
            Giữ lại
          </button>
          <button
            type="button"
            className="ss-button danger"
            onClick={onConfirm}
          >
            Xóa tệp
          </button>
        </div>
      </section>
    </div>
  );
}
