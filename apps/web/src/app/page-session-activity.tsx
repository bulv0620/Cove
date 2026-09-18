import { createContext, useContext, type PropsWithChildren } from 'react';

const PageSessionActivityContext = createContext(true);

export function PageSessionActivityProvider({
  active,
  children,
}: PropsWithChildren<{ active: boolean }>): JSX.Element {
  return (
    <PageSessionActivityContext.Provider value={active}>
      {children}
    </PageSessionActivityContext.Provider>
  );
}

export function usePageSessionActivity(): boolean {
  return useContext(PageSessionActivityContext);
}
