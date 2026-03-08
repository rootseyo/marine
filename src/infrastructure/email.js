const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send email using Resend
 */
async function sendEmail({ to, subject, html, attachments = [] }) {
    try {
        const data = await resend.emails.send({
            from: 'Marine AI <noreply@brightnetworks.kr>',
            to,
            subject,
            html,
            attachments
        });
        return { success: true, data };
    } catch (error) {
        console.error("[Email Service] Failed to send email:", error);
        return { success: false, error };
    }
}

module.exports = {
    sendEmail
};
