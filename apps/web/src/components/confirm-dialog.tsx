"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState, type ReactNode } from "react";

type Request = { message: string; accept: string; danger?: boolean };

/**
 * In-page confirmation (legacy confirm-dialog.js, styled as `.mail-folder-dialog`).
 *
 *   const [confirm, dialog] = useConfirm();
 *   if (await confirm({ message, accept })) ...
 *   return <>{dialog}...</>;
 */
export function useConfirm(): [(request: Request) => Promise<boolean>, ReactNode] {
  const t = useTranslations("Common");
  const [request, setRequest] = useState<Request | null>(null);
  const resolver = useRef<(value: boolean) => void>(undefined);

  const confirm = useCallback(
    (next: Request) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setRequest(next);
      }),
    [],
  );

  const finish = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = undefined;
    setRequest(null);
  };

  const dialog = (
    <AlertDialog.Root open={!!request} onOpenChange={(open) => !open && finish(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[1000] bg-[#162c2170]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[1001] max-h-[calc(100%-2rem)] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-control border border-green bg-white p-[clamp(1.2rem,4vw,2rem)] text-ink">
          <AlertDialog.Title className="sr-only">{request?.accept}</AlertDialog.Title>
          <AlertDialog.Description className="leading-[1.55]">{request?.message}</AlertDialog.Description>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-[.8rem]">
            <AlertDialog.Cancel className="btn">{t("cancel")}</AlertDialog.Cancel>
            <AlertDialog.Action
              className={request?.danger ? "btn text-error" : "btn btn-primary"}
              onClick={() => finish(true)}
            >
              {request?.accept}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );

  return [confirm, dialog];
}
