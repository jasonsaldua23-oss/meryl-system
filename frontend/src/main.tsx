
  import { createRoot } from "react-dom/client";
  import { QueryClientProvider } from "@tanstack/react-query";
  import App from "./app/App.tsx";
  import { AuthProvider } from "./lib/auth-context.tsx";
  import { queryClient } from "./lib/query-client.ts";
  import "./styles/index.css";
  import { setupReceiptPrinting } from "./lib/receipt-print";

  setupReceiptPrinting();

  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>,
  );
  
