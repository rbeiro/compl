// Strings that did not exist in the legacy portal (no legacy translation to
// import). Same shape as the generated catalogs; merged by
// import-legacy-messages.mjs. Spanish is the source; keep all 7 languages.
const t = (es, en, ca, it, pt, fr, ar) => ({ es, en, ca, it, pt, fr, ar });

const newMessages = {
  Verification: {
    // Two-step codes are now emailed (legacy used an authenticator app).
    intro: t(
      'Te hemos enviado un código de seis dígitos por correo. Introdúcelo para entrar.',
      'We have emailed you a six-digit code. Enter it to sign in.',
      'T’hem enviat un codi de sis xifres per correu. Introdueix-lo per entrar.',
      'Ti abbiamo inviato un codice di sei cifre via email. Inseriscilo per accedere.',
      'Enviámos-te um código de seis dígitos por email. Introduz-o para entrar.',
      'Nous vous avons envoyé un code à six chiffres par e-mail. Saisissez-le pour vous connecter.',
      'أرسلنا إليك رمزًا من ستة أرقام عبر البريد الإلكتروني. أدخله لتسجيل الدخول.',
    ),
    resend: t('Enviar un código nuevo', 'Send a new code', 'Envia un codi nou', 'Invia un nuovo codice', 'Enviar um novo código', 'Envoyer un nouveau code', 'إرسال رمز جديد'),
    resent: t(
      'Te hemos enviado un código nuevo.',
      'We have sent you a new code.',
      'T’hem enviat un codi nou.',
      'Ti abbiamo inviato un nuovo codice.',
      'Enviámos-te um novo código.',
      'Nous vous avons envoyé un nouveau code.',
      'أرسلنا إليك رمزًا جديدًا.',
    ),
    invalid: t(
      'El código no es correcto. Compruébalo e inténtalo de nuevo.',
      'That code is not correct. Check it and try again.',
      'El codi no és correcte. Comprova’l i torna-ho a provar.',
      'Il codice non è corretto. Controllalo e riprova.',
      'O código não está correto. Verifica-o e tenta novamente.',
      'Ce code n’est pas correct. Vérifiez-le et réessayez.',
      'الرمز غير صحيح. تحقّق منه وحاول مرة أخرى.',
    ),
    expired: t(
      'El código ha caducado. Pide uno nuevo.',
      'The code has expired. Ask for a new one.',
      'El codi ha caducat. Demana’n un de nou.',
      'Il codice è scaduto. Richiedine uno nuovo.',
      'O código expirou. Pede um novo.',
      'Le code a expiré. Demandez-en un nouveau.',
      'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.',
    ),
    locked: t(
      'Demasiados intentos. Pide un código nuevo.',
      'Too many attempts. Ask for a new code.',
      'Massa intents. Demana un codi nou.',
      'Troppi tentativi. Richiedi un nuovo codice.',
      'Demasiadas tentativas. Pede um novo código.',
      'Trop de tentatives. Demandez un nouveau code.',
      'محاولات كثيرة جدًا. اطلب رمزًا جديدًا.',
    ),
    failed: t(
      'No se pudo verificar el código. Inténtalo de nuevo.',
      'The code could not be checked. Try again.',
      'No s’ha pogut verificar el codi. Torna-ho a provar.',
      'Impossibile verificare il codice. Riprova.',
      'Não foi possível verificar o código. Tenta novamente.',
      'Le code n’a pas pu être vérifié. Réessayez.',
      'تعذّر التحقق من الرمز. حاول مرة أخرى.',
    ),
  },
};
export default newMessages;
