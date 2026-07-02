// Envío de emails de recuperación de contraseña.
//
// Para que esto mande correos de verdad, completá estas variables de entorno
// (por ejemplo en un archivo .env en la raíz del proyecto — ver .env.example):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, APP_URL
//
// Si no están configuradas, en vez de fallar, el link de recuperación se
// imprime en la consola del servidor — así se puede probar todo el flujo
// en local sin tener que configurar un SMTP real.

const nodemailer = require('nodemailer');

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendPasswordResetEmail(toEmail, userName, resetLink) {
  if (!isConfigured()) {
    console.log('\n[email] SMTP no configurado. Este es el link de recuperación que le hubiera llegado a', toEmail, ':');
    console.log('[email] ' + resetLink + '\n');
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const transporter = getTransport();
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: toEmail,
      subject: 'Recuperar tu contraseña de CleanCave',
      text: `Hola ${userName},\n\nPara elegir una contraseña nueva entrá a este link (vale por 1 hora):\n${resetLink}\n\nSi no pediste esto, podés ignorar este correo.`,
      html: `<p>Hola ${userName},</p><p>Para elegir una contraseña nueva entrá a este link (vale por 1 hora):</p><p><a href="${resetLink}">${resetLink}</a></p><p>Si no pediste esto, podés ignorar este correo.</p>`
    });
    return { sent: true };
  } catch (err) {
    console.error('[email] Error enviando el correo de recuperación:', err.message);
    console.log('[email] Link de recuperación (por si el correo no llegó):', resetLink);
    return { sent: false, reason: 'send_error' };
  }
}

module.exports = { sendPasswordResetEmail, isConfigured };
