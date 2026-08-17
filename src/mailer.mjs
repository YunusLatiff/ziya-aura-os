import tls from 'node:tls';
import crypto from 'node:crypto';

const cleanHeader = s =>
  String(s || '')
    .replace(/[\r\n]+/g, ' ')
    .trim();

const env = name =>
  String(process.env[name] || '')
    .trim();

const envBool = (name, fallback = false) => {
  const raw = env(name);

  if (!raw) {
    return fallback;
  }

  return [
    '1',
    'true',
    'yes',
    'on',
    'enabled'
  ].includes(raw.toLowerCase());
};

function b64(s) {
  return Buffer
    .from(String(s), 'utf8')
    .toString('base64');
}

function mimeWord(s) {
  const v = cleanHeader(s);

  return /^[\x20-\x7E]*$/.test(v)
    ? v
    : `=?UTF-8?B?${b64(v)}?=`;
}

function addr(name, email) {
  const n = cleanHeader(name);
  const e = cleanHeader(email);

  return n
    ? `${mimeWord(n)} <${e}>`
    : e;
}

/*
 * SMTP CONFIG
 */

export function smtpConfig() {
  const port =
    Number(
      env('OUTBOUND_SMTP_PORT') ||
      465
    );

  return {
    host:
      env('OUTBOUND_SMTP_HOST'),

    port:
      Number.isFinite(port)
        ? port
        : 465,

    user:
      env('OUTBOUND_SMTP_USER'),

    password:
      env('OUTBOUND_SMTP_PASSWORD'),

    fromEmail:
      env('OUTBOUND_FROM_EMAIL') ||
      env('OUTBOUND_SMTP_USER'),

    fromName:
      env('OUTBOUND_FROM_NAME') ||
      'Ziya Energy',

    replyTo:
      env('OUTBOUND_REPLY_TO') ||
      env('OUTBOUND_FROM_EMAIL') ||
      env('OUTBOUND_SMTP_USER')
  };
}

export function smtpReady() {
  const c = smtpConfig();

  return !!(
    c.host &&
    c.port &&
    c.user &&
    c.password &&
    c.fromEmail
  );
}

/*
 * IMAP / SENT COPY CONFIG
 *
 * SMTP sends the message.
 * IMAP saves a copy into Sent.
 */

export function imapConfig() {
  const smtp =
    smtpConfig();

  const port =
    Number(
      env('OUTBOUND_IMAP_PORT') ||
      993
    );

  return {
    host:
      env('OUTBOUND_IMAP_HOST') ||
      'imap.titan.email',

    port:
      Number.isFinite(port)
        ? port
        : 993,

    user:
      env('OUTBOUND_IMAP_USER') ||
      smtp.user,

    password:
      env('OUTBOUND_IMAP_PASSWORD') ||
      smtp.password,

    sentMailbox:
      env('OUTBOUND_SENT_MAILBOX') ||
      'Sent',

    saveSentCopy:
      envBool(
        'OUTBOUND_SAVE_SENT_COPY',
        true
      )
  };
}

export function imapReady() {
  const c = imapConfig();

  return !!(
    c.host &&
    c.port &&
    c.user &&
    c.password &&
    c.sentMailbox
  );
}

/*
 * MIME MESSAGE
 */

export function buildMessage({
  toEmail,
  toName,
  subject,
  body,
  messageId
}) {
  const c =
    smtpConfig();

  const id =
    messageId ||
    `<${crypto.randomUUID()}@${
      c.fromEmail.split('@')[1] ||
      'ziyaenergy.local'
    }>`;

  const footer =
    'If this is not relevant, reply and let us know and we will not follow up.';

  const text =
    String(body || '').trimEnd() +
    `\n\n${footer}`;

  const headers = [
    `From: ${addr(
      c.fromName,
      c.fromEmail
    )}`,

    `To: ${addr(
      toName,
      toEmail
    )}`,

    `Reply-To: ${cleanHeader(
      c.replyTo
    )}`,

    `Subject: ${mimeWord(
      subject
    )}`,

    `Date: ${
      new Date().toUTCString()
    }`,

    `Message-ID: ${cleanHeader(
      id
    )}`,

    'MIME-Version: 1.0',

    'Content-Type: text/plain; charset=UTF-8',

    'Content-Transfer-Encoding: 8bit',

    'Auto-Submitted: no'
  ];

  return {
    messageId: id,

    raw:
      headers.join('\r\n') +
      '\r\n\r\n' +
      text.replace(
        /\r?\n/g,
        '\r\n'
      ) +
      '\r\n'
  };
}

/*
 * GENERIC LINE READER
 *
 * Used by SMTP and IMAP.
 */

function createLineReader(
  socket,
  label
) {
  let buffer = '';

  const queued = [];
  const waiters = [];

  let terminalError = null;

  function deliver(line) {
    if (waiters.length) {
      const w =
        waiters.shift();

      clearTimeout(
        w.timer
      );

      w.resolve(line);
    }
    else {
      queued.push(line);
    }
  }

  function fail(err) {
    if (terminalError) {
      return;
    }

    terminalError =
      err instanceof Error
        ? err
        : new Error(
            String(err)
          );

    while (waiters.length) {
      const w =
        waiters.shift();

      clearTimeout(
        w.timer
      );

      w.reject(
        terminalError
      );
    }
  }

  socket.on(
    'data',
    chunk => {
      buffer +=
        chunk.toString(
          'utf8'
        );

      const lines =
        buffer.split(
          /\r?\n/
        );

      buffer =
        lines.pop() ||
        '';

      for (
        const line of lines
      ) {
        if (line !== '') {
          deliver(line);
        }
      }
    }
  );

  socket.on(
    'error',
    fail
  );

  socket.on(
    'close',
    hadError => {
      if (
        !terminalError &&
        hadError
      ) {
        fail(
          new Error(
            `${label} connection closed with an error.`
          )
        );
      }
    }
  );

  function nextLine(
    timeoutMs = 25000
  ) {
    if (queued.length) {
      return Promise.resolve(
        queued.shift()
      );
    }

    if (terminalError) {
      return Promise.reject(
        terminalError
      );
    }

    return new Promise(
      (
        resolve,
        reject
      ) => {
        const timer =
          setTimeout(
            () => {
              const idx =
                waiters.findIndex(
                  w =>
                    w.resolve ===
                    resolve
                );

              if (idx >= 0) {
                waiters.splice(
                  idx,
                  1
                );
              }

              reject(
                new Error(
                  `${label} response timed out.`
                )
              );
            },

            timeoutMs
          );

        waiters.push({
          resolve,
          reject,
          timer
        });
      }
    );
  }

  return {
    nextLine,
    fail
  };
}

/*
 * SMTP SESSION
 */

function smtpSession(config) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const socket =
        tls.connect({
          host:
            config.host,

          port:
            config.port,

          servername:
            config.host,

          rejectUnauthorized:
            true
        });

      let closed =
        false;

      const reader =
        createLineReader(
          socket,
          'SMTP'
        );

      function fail(err) {
        if (closed) {
          return;
        }

        closed = true;

        try {
          socket.destroy();
        }
        catch {}

        reject(err);
      }

      socket.once(
        'error',
        fail
      );

      socket.setTimeout(
        25000,
        () =>
          fail(
            new Error(
              'SMTP connection timed out.'
            )
          )
      );

      socket.once(
        'secureConnect',
        () => {
          socket.setTimeout(0);

          async function response(
            expected
          ) {
            const wanted =
              Array.isArray(
                expected
              )
                ? expected
                : [expected];

            const lines = [];

            while (true) {
              const line =
                await reader
                  .nextLine();

              const m =
                line.match(
                  /^(\d{3})([- ])(.*)$/
                );

              if (!m) {
                continue;
              }

              lines.push(line);

              if (
                m[2] !== ' '
              ) {
                continue;
              }

              const code =
                Number(
                  m[1]
                );

              if (
                !wanted.includes(
                  code
                )
              ) {
                throw new Error(
                  `SMTP ${code}: ${
                    lines.join(
                      ' | '
                    )
                  }`
                );
              }

              return {
                code,
                text:
                  lines.join(
                    '\n'
                  )
              };
            }
          }

          async function command(
            text,
            expected
          ) {
            socket.write(
              text +
              '\r\n'
            );

            return response(
              expected
            );
          }

          resolve({
            socket,

            response,

            command,

            close: () => {
              if (closed) {
                return;
              }

              closed = true;

              try {
                socket.end();
              }
              catch {}
            }
          });
        }
      );
    }
  );
}

/*
 * IMAP SESSION
 */

function imapQuote(value) {
  return `"${String(value)
    .replace(
      /\\/g,
      '\\\\'
    )
    .replace(
      /"/g,
      '\\"'
    )}"`;
}

function imapSession(config) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const socket =
        tls.connect({
          host:
            config.host,

          port:
            config.port,

          servername:
            config.host,

          rejectUnauthorized:
            true
        });

      let closed =
        false;

      let counter =
        0;

      const reader =
        createLineReader(
          socket,
          'IMAP'
        );

      function fail(err) {
        if (closed) {
          return;
        }

        closed = true;

        try {
          socket.destroy();
        }
        catch {}

        reject(err);
      }

      socket.once(
        'error',
        fail
      );

      socket.setTimeout(
        25000,
        () =>
          fail(
            new Error(
              'IMAP connection timed out.'
            )
          )
      );

      socket.once(
        'secureConnect',
        async () => {
          try {
            socket.setTimeout(
              0
            );

            const greeting =
              await reader
                .nextLine();

            if (
              !/^\*\s+(OK|PREAUTH)\b/i
                .test(
                  greeting
                )
            ) {
              throw new Error(
                `Unexpected IMAP greeting: ${greeting}`
              );
            }

            function nextTag() {
              counter += 1;

              return (
                'A' +
                String(
                  counter
                ).padStart(
                  4,
                  '0'
                )
              );
            }

            async function readTagged(
              tag
            ) {
              const lines = [];

              while (true) {
                const line =
                  await reader
                    .nextLine();

                lines.push(
                  line
                );

                if (
                  !line.startsWith(
                    `${tag} `
                  )
                ) {
                  continue;
                }

                if (
                  !new RegExp(
                    `^${tag}\\s+OK\\b`,
                    'i'
                  ).test(
                    line
                  )
                ) {
                  throw new Error(
                    `IMAP command failed: ${
                      lines.join(
                        ' | '
                      )
                    }`
                  );
                }

                return lines;
              }
            }

            async function command(
              commandText
            ) {
              const tag =
                nextTag();

              socket.write(
                `${tag} ${commandText}\r\n`
              );

              return readTagged(
                tag
              );
            }

            async function append(
              mailbox,
              raw
            ) {
              const tag =
                nextTag();

              const bytes =
                Buffer.from(
                  raw,
                  'utf8'
                );

              socket.write(
                `${tag} APPEND ${imapQuote(
                  mailbox
                )} (\\Seen) {${bytes.length}}\r\n`
              );

              while (true) {
                const line =
                  await reader
                    .nextLine();

                if (
                  line.startsWith(
                    '+'
                  )
                ) {
                  break;
                }

                if (
                  line.startsWith(
                    `${tag} `
                  )
                ) {
                  throw new Error(
                    `IMAP APPEND rejected before upload: ${line}`
                  );
                }
              }

              socket.write(
                bytes
              );

              socket.write(
                '\r\n'
              );

              await readTagged(
                tag
              );

              return {
                ok: true,
                mailbox
              };
            }

            async function logout() {
              try {
                await command(
                  'LOGOUT'
                );
              }
              catch {}

              if (!closed) {
                closed = true;

                try {
                  socket.end();
                }
                catch {}
              }
            }

            resolve({
              socket,
              command,
              append,
              logout
            });
          }
          catch (e) {
            fail(e);
          }
        }
      );
    }
  );
}

/*
 * SAVE MIME COPY INTO TITAN SENT
 */

export async function appendSentCopy(
  raw
) {
  const c =
    imapConfig();

  if (
    !c.saveSentCopy
  ) {
    return {
      ok: false,

      skipped: true,

      reason:
        'OUTBOUND_SAVE_SENT_COPY is disabled.'
    };
  }

  if (
    !imapReady()
  ) {
    throw new Error(
      'Outbound IMAP is not fully configured.'
    );
  }

  const s =
    await imapSession(
      c
    );

  try {
    await s.command(
      `LOGIN ${imapQuote(
        c.user
      )} ${imapQuote(
        c.password
      )}`
    );

    await s.append(
      c.sentMailbox,
      raw
    );

    return {
      ok: true,

      mailbox:
        c.sentMailbox
    };
  }
  finally {
    await s
      .logout()
      .catch(
        () => {}
      );
  }
}

/*
 * SEND + SAVE SENT COPY
 */

export async function sendSmtpMail({
  toEmail,
  toName,
  subject,
  body,
  messageId
}) {
  const c =
    smtpConfig();

  if (
    !smtpReady()
  ) {
    throw new Error(
      'Outbound SMTP is not fully configured.'
    );
  }

  const built =
    buildMessage({
      toEmail,
      toName,
      subject,
      body,
      messageId
    });

  const s =
    await smtpSession(
      c
    );

  let smtpAccepted;

  try {
    await s.response(
      220
    );

    await s.command(
      'EHLO aura.ziyaenergy.local',
      250
    );

    await s.command(
      'AUTH LOGIN',
      334
    );

    await s.command(
      b64(c.user),
      334
    );

    await s.command(
      b64(c.password),
      235
    );

    await s.command(
      `MAIL FROM:<${c.fromEmail}>`,
      250
    );

    await s.command(
      `RCPT TO:<${cleanHeader(
        toEmail
      )}>`,
      [
        250,
        251
      ]
    );

    await s.command(
      'DATA',
      354
    );

    const stuffed =
      built.raw.replace(
        /^\./gm,
        '..'
      );

    s.socket.write(
      stuffed +
      '\r\n.\r\n'
    );

    /*
     * This 250 response means the SMTP
     * server accepted the message.
     */
    smtpAccepted =
      await s.response(
        250
      );

    await s
      .command(
        'QUIT',
        221
      )
      .catch(
        () => {}
      );
  }
  finally {
    s.close();
  }

  /*
   * SMTP already accepted the email.
   *
   * IMAP failure MUST NOT turn this into
   * FAILED because doing that could cause
   * a duplicate resend later.
   */

  let sentCopySaved =
    false;

  let sentCopyMailbox =
    null;

  let sentCopyError =
    null;

  try {
    const copy =
      await appendSentCopy(
        built.raw
      );

    sentCopySaved =
      copy.ok === true;

    sentCopyMailbox =
      copy.mailbox ||
      null;

    if (
      copy.skipped
    ) {
      sentCopyError =
        copy.reason ||
        'Sent-copy append skipped.';
    }
  }
  catch (e) {
    sentCopyError =
      String(
        e?.message ||
        e
      );

    console.error(
      '[OUTBOUND SENT COPY ERROR]',
      sentCopyError
    );
  }

  return {
    ok: true,

    messageId:
      built.messageId,

    /*
     * Distinguish SMTP acceptance from
     * Sent-folder storage.
     */
    smtpAccepted:
      true,

    smtpResponse:
      smtpAccepted?.text ||
      null,

    sentCopySaved,

    sentCopyMailbox,

    sentCopyError
  };
}