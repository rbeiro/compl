import { getLocale, getTranslations } from "next-intl/server";
import { signOut } from "@/app/actions/auth";
import { Icon } from "./icon";

export async function SignOutButton({
  label,
  className = "btn",
  icon = true,
}: { label?: string; className?: string; icon?: boolean } = {}) {
  const locale = await getLocale();
  const c = await getTranslations("Common");
  return (
    <form action={signOut}>
      <input type="hidden" name="locale" value={locale} />
      <button type="submit" className={className}>
        {icon && <Icon name="logout" />} {label ?? c("signOut")}
      </button>
    </form>
  );
}
