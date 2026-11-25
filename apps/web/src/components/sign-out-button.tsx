import { getLocale, getTranslations } from "next-intl/server";
import { signOut } from "@/app/actions/auth";
import { Icon } from "./icon";

export async function SignOutButton() {
  const locale = await getLocale();
  const c = await getTranslations("Common");
  return (
    <form action={signOut}>
      <input type="hidden" name="locale" value={locale} />
      <button type="submit" className="btn">
        <Icon name="logout" /> {c("signOut")}
      </button>
    </form>
  );
}
