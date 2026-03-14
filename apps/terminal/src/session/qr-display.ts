import * as qrcodeTerminal from 'qrcode-terminal';

export function displayQr(qrPayload: string, serverUrl: string, token: string): void {
  console.clear();
  console.log('\n\x1b[1m\x1b[36m  remote-claude\x1b[0m  — scan to pair your phone\n');
  qrcodeTerminal.generate(qrPayload, { small: true });
  console.log('\n  Server : ' + serverUrl);
  console.log('  Token  : ' + token.slice(0, 8) + '…' + token.slice(-8));
  console.log('\n  Waiting for mobile to connect…\n');
}
