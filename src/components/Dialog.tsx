import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return <dialog ref={dialog} className={wide ? 'dialog dialog-wide' : 'dialog'} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="dialog-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="ปิด" onClick={onClose}><X size={21}/></button></header>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
