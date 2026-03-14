import { Provide } from '@midwayjs/decorator';
import * as QRCode from 'qrcode';

@Provide()
export class QrService {
  async toPng(text: string): Promise<Buffer> {
    return QRCode.toBuffer(text, {
      errorCorrectionLevel: 'M',
      type: 'png',
      width: 400,
      margin: 2,
    });
  }

  async toDataUrl(text: string): Promise<string> {
    return QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      width: 400,
      margin: 2,
    });
  }
}
