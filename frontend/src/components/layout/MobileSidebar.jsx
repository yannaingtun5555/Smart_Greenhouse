import { createContext, useContext, useState, useEffect } from 'react';

const MobileSidebarContext = createContext({
  open: false,
  openSidebar: () => {},
  closeSidebar: () => {},
});

export function useMobileSidebar() {
  return useContext(MobileSidebarContext);
}

export default function MobileSidebarProvider({ children }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <MobileSidebarContext.Provider value={{
      open,
      openSidebar: () => setOpen(true),
      closeSidebar: () => setOpen(false),
    }}
    >
      {children}
    </MobileSidebarContext.Provider>
  );
}
