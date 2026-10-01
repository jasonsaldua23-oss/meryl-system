/** Print receipts outside dialog positioning, transforms and scroll containers. */
export function setupReceiptPrinting() {
  let printRoot: HTMLDivElement | null = null;

  const cleanup = () => {
    printRoot?.remove();
    printRoot = null;
    document.body.classList.remove("printing-receipt");
  };

  const prepare = () => {
    cleanup();
    const receipt = Array.from(document.querySelectorAll<HTMLElement>(
      "#printable-receipt, #printable-exchange-slip",
    )).find((element) => element.getClientRects().length > 0);
    if (!receipt) return;

    const copy = receipt.cloneNode(true) as HTMLElement;
    copy.id = "receipt-print-content";
    printRoot = document.createElement("div");
    printRoot.id = "receipt-print-root";
    printRoot.setAttribute("aria-hidden", "true");
    printRoot.append(copy);
    document.body.append(printRoot);
    document.body.classList.add("printing-receipt");
  };

  // Covers the receipt buttons as well as the browser's Print command.
  window.addEventListener("beforeprint", prepare);
  window.addEventListener("afterprint", cleanup);

  return () => {
    window.removeEventListener("beforeprint", prepare);
    window.removeEventListener("afterprint", cleanup);
    cleanup();
  };
}
