// Pure module: the recipient page and the owner's contact form both read it.

export type EmailKind = "personal" | "work";

/** Mail people get as individuals. Everything else counts as work, unless the owner says otherwise. */
export const CONSUMER_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Webmail
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "aim.com",
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me",
  "hey.com", "fastmail.com", "fastmail.fm", "fastmail.net", "fastmail.org",
  "tutanota.com", "tutanota.de", "tuta.com", "tuta.io", "tutamail.com",
  "zoho.com", "zohomail.com", "mail.com", "email.com", "inbox.com",
  "duck.com", "skiff.com", "hushmail.com", "mailbox.org", "posteo.de", "posteo.net",
  "yandex.com", "yandex.ru", "ya.ru", "mail.ru", "bk.ru", "inbox.ru", "list.ru",
  // Yahoo, by country
  "yahoo.com", "ymail.com", "rocketmail.com",
  "yahoo.ca", "yahoo.co.uk", "yahoo.co.in", "yahoo.in", "yahoo.co.jp", "yahoo.co.kr",
  "yahoo.co.nz", "yahoo.co.id", "yahoo.co.th", "yahoo.co.za", "yahoo.com.au",
  "yahoo.com.ar", "yahoo.com.br", "yahoo.com.cn", "yahoo.com.hk", "yahoo.com.mx",
  "yahoo.com.my", "yahoo.com.ph", "yahoo.com.sg", "yahoo.com.tw", "yahoo.com.vn",
  "yahoo.de", "yahoo.es", "yahoo.fr", "yahoo.gr", "yahoo.ie", "yahoo.it", "yahoo.nl",
  "yahoo.pl", "yahoo.pt", "yahoo.ro", "yahoo.se",
  // Outlook and Hotmail, by country
  "outlook.co.uk", "outlook.de", "outlook.es", "outlook.fr", "outlook.it", "outlook.jp",
  "hotmail.ca", "hotmail.co.uk", "hotmail.de", "hotmail.es", "hotmail.fr", "hotmail.it",
  "hotmail.nl", "live.ca", "live.co.uk", "live.com.au", "live.de", "live.fr", "live.it",
  "live.nl", "msn.cn",
  // US and Canadian ISPs
  "comcast.net", "xfinity.com", "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net",
  "ameritech.net", "pacbell.net", "swbell.net", "flash.net", "prodigy.net", "cox.net",
  "charter.net", "spectrum.net", "rr.com", "roadrunner.com", "twc.com", "brighthouse.com",
  "optonline.net", "optimum.net", "frontier.com", "frontiernet.net", "centurylink.net",
  "centurytel.net", "q.com", "windstream.net", "earthlink.net", "mindspring.com",
  "juno.com", "netzero.net", "netzero.com", "rcn.com", "wowway.com", "mediacombb.net",
  "sympatico.ca", "bell.net", "rogers.com", "shaw.ca", "telus.net", "videotron.ca",
  "cogeco.ca", "eastlink.ca",
  // UK, Europe
  "btinternet.com", "bt.com", "btopenworld.com", "sky.com", "talktalk.net", "virginmedia.com",
  "ntlworld.com", "blueyonder.co.uk", "tiscali.co.uk", "plus.net", "eircom.net",
  "gmx.com", "gmx.net", "gmx.de", "gmx.at", "gmx.ch", "gmx.fr", "gmx.co.uk", "gmx.us",
  "web.de", "t-online.de", "freenet.de", "arcor.de",
  "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "laposte.net", "neuf.fr",
  "libero.it", "virgilio.it", "alice.it", "tin.it", "tiscali.it", "fastwebnet.it",
  "ziggo.nl", "kpnmail.nl", "planet.nl", "xs4all.nl", "home.nl", "telenet.be", "skynet.be",
  "bluewin.ch", "seznam.cz", "wp.pl", "o2.pl", "interia.pl", "onet.pl",
  "telefonica.net", "terra.es", "sapo.pt",
  // Asia Pacific, Latin America
  "qq.com", "foxmail.com", "163.com", "126.com", "yeah.net", "sina.com", "sina.cn",
  "sohu.com", "aliyun.com", "139.com", "189.cn",
  "naver.com", "daum.net", "hanmail.net", "kakao.com", "nate.com",
  "docomo.ne.jp", "ezweb.ne.jp", "softbank.ne.jp", "nifty.com", "ocn.ne.jp",
  "rediffmail.com", "bigpond.com", "bigpond.net.au", "optusnet.com.au", "iinet.net.au",
  "tpg.com.au", "xtra.co.nz", "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br",
  "globo.com",
]);

function emailDomain(email: string | null | undefined): string | null {
  const address = email?.trim() ?? "";
  const at = address.lastIndexOf("@");
  if (at < 1 || at === address.length - 1 || address.indexOf("@") !== at) return null;
  return address.slice(at + 1).toLowerCase();
}

/** True when an address outside the consumer list, or one the owner marked as work. */
export function isWorkEmail(
  email: string | null | undefined,
  { kind = null }: { kind?: EmailKind | null } = {},
): boolean {
  const domain = emailDomain(email);
  if (domain === null) return false;
  if (kind !== null) return kind === "work";
  return !CONSUMER_EMAIL_DOMAINS.has(domain);
}
