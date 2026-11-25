import type { Email } from "./mailer.js";

export const locales = ["es", "en", "ca", "it", "pt", "fr", "ar"] as const;
export type Locale = (typeof locales)[number];

export function toLocale(value: unknown): Locale {
  return locales.includes(value as Locale) ? (value as Locale) : "es";
}

// Texts for the emails the API sends. Spanish is the source; the other
// languages follow the portal's tone (informal "tú" where the portal uses it).
const copy = {
  secondFactor: {
    es: { subject: "Tu código de verificación de CompI", intro: "Usa este código para terminar de iniciar sesión en CompI:", expiry: "Caduca en 10 minutos. Si no has intentado entrar, ignora este correo y cambia tu contraseña." },
    en: { subject: "Your CompI verification code", intro: "Use this code to finish signing in to CompI:", expiry: "It expires in 10 minutes. If you did not try to sign in, ignore this email and change your password." },
    ca: { subject: "El teu codi de verificació de CompI", intro: "Fes servir aquest codi per acabar d’iniciar la sessió a CompI:", expiry: "Caduca d’aquí a 10 minuts. Si no has intentat entrar, ignora aquest correu i canvia la contrasenya." },
    it: { subject: "Il tuo codice di verifica CompI", intro: "Usa questo codice per completare l’accesso a CompI:", expiry: "Scade tra 10 minuti. Se non hai provato ad accedere, ignora questa email e cambia la password." },
    pt: { subject: "O teu código de verificação do CompI", intro: "Usa este código para terminar o início de sessão no CompI:", expiry: "Expira dentro de 10 minutos. Se não tentaste entrar, ignora este email e altera a tua palavra-passe." },
    fr: { subject: "Votre code de vérification CompI", intro: "Utilisez ce code pour terminer votre connexion à CompI :", expiry: "Il expire dans 10 minutes. Si vous n’avez pas essayé de vous connecter, ignorez cet e-mail et changez votre mot de passe." },
    ar: { subject: "رمز التحقق الخاص بك في CompI", intro: "استخدم هذا الرمز لإكمال تسجيل الدخول إلى CompI:", expiry: "تنتهي صلاحيته خلال 10 دقائق. إذا لم تحاول تسجيل الدخول، فتجاهل هذه الرسالة وغيّر كلمة المرور." },
  },
  invitation: {
    es: { subject: "Tu invitación a CompI", intro: "Te han invitado a CompI, el portal de tu cocina.", action: "Establecer mi contraseña", note: "El enlace es de un solo uso y caduca en una hora." },
    en: { subject: "Your invitation to CompI", intro: "You have been invited to CompI, your kitchen workspace.", action: "Set my password", note: "The link can be used once and expires in one hour." },
    ca: { subject: "La teva invitació a CompI", intro: "T’han convidat a CompI, el portal de la teva cuina.", action: "Establir la meva contrasenya", note: "L’enllaç és d’un sol ús i caduca d’aquí a una hora." },
    it: { subject: "Il tuo invito a CompI", intro: "Sei stato invitato a CompI, il portale della tua cucina.", action: "Imposta la mia password", note: "Il link è monouso e scade tra un’ora." },
    pt: { subject: "O teu convite para o CompI", intro: "Foste convidado para o CompI, o portal da tua cozinha.", action: "Definir a minha palavra-passe", note: "A ligação só pode ser usada uma vez e expira dentro de uma hora." },
    fr: { subject: "Votre invitation à CompI", intro: "Vous êtes invité à rejoindre CompI, le portail de votre cuisine.", action: "Choisir mon mot de passe", note: "Le lien n’est valable qu’une fois et expire dans une heure." },
    ar: { subject: "دعوتك إلى CompI", intro: "تمت دعوتك إلى CompI، بوابة مطبخك.", action: "تعيين كلمة المرور", note: "الرابط صالح للاستخدام مرة واحدة وتنتهي صلاحيته خلال ساعة." },
  },
} as const;

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(locale: Locale, inner: string) {
  const dir = locale === "ar" ? "rtl" : "ltr";
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#faf7f2;font-family:Manrope,Arial,sans-serif;color:#242c27">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #d9d4c9;border-radius:12px" cellpadding="0" cellspacing="0"><tr><td style="padding:32px">
<p style="margin:0 0 24px;font-family:Georgia,serif;font-size:24px;color:#23603f">CompI</p>
${inner}
</td></tr></table></td></tr></table></body></html>`;
}

export function secondFactorEmail(to: string, code: string, locale: Locale): Email {
  const t = copy.secondFactor[locale];
  const html = layout(
    locale,
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.6">${escape(t.intro)}</p>
<p style="margin:0 0 24px;font-size:32px;letter-spacing:.3em;font-weight:700;color:#23603f" dir="ltr">${code}</p>
<p style="margin:0;font-size:14px;line-height:1.6;color:#566158">${escape(t.expiry)}</p>`,
  );
  return { to, subject: t.subject, html, text: `${t.intro}\n\n${code}\n\n${t.expiry}` };
}

export function invitationEmail(to: string, link: string, locale: Locale): Email {
  const t = copy.invitation[locale];
  const html = layout(
    locale,
    `<p style="margin:0 0 24px;font-size:16px;line-height:1.6">${escape(t.intro)}</p>
<p style="margin:0 0 24px"><a href="${escape(link)}" style="display:inline-block;padding:12px 20px;background:#23603f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">${escape(t.action)}</a></p>
<p style="margin:0;font-size:14px;line-height:1.6;color:#566158">${escape(t.note)}</p>`,
  );
  return { to, subject: t.subject, html, text: `${t.intro}\n\n${t.action}: ${link}\n\n${t.note}` };
}
