"use client";

import { Toaster } from "react-hot-toast";

export default function ToasterProvider() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        className: "!bg-card !text-card-foreground !border !border-border !shadow-lg !text-sm",
        error: { duration: 6000 },
      }}
    />
  );
}
