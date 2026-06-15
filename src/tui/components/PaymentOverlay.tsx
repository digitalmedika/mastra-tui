import {
  assistantMarkerFg,
  greenFg,
  inputBorderFg,
  mutedFg,
  redFg,
  runBg,
  textFg,
} from '../constants';
import { Badge } from './Badge';

export type PaymentPhase = 'select' | 'loading' | 'ready' | 'error';

export interface PaymentData {
  id: string;
  orderId: string;
  txnId: string | null;
  amountIdr: number;
  qrCodeUrl: string | null;
  redirectUrl: string | null;
  payInstructions: string | null;
  timeoutMinutes: number | null;
}

export const PAYMENT_AMOUNTS = [
  { label: 'Rp 10.000', value: 10000 },
  { label: 'Rp 30.000', value: 30000 },
  { label: 'Rp 50.000', value: 50000 },
  { label: 'Rp 100.000', value: 100000 },
];

export interface PaymentOverlayProps {
  phase: PaymentPhase;
  selectedIndex: number;
  paymentData: PaymentData | null;
  error: string | null;
}

export function PaymentOverlay({ phase, selectedIndex, paymentData, error }: PaymentOverlayProps) {
  return (
    <box
      style={{
        width: '100%',
        flexDirection: 'column',
        border: true,
        borderStyle: 'single',
        borderColor: inputBorderFg,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
        flexShrink: 0,
      }}
    >
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label="TOP UP" bg={runBg} />
        <text content="  Saldo habis. Pilih nominal untuk isi ulang:" style={{ fg: mutedFg }} />
      </box>

      {phase === 'select' ? (
        <>
          <box style={{ width: '100%', flexDirection: 'column', paddingTop: 1 }}>
            {PAYMENT_AMOUNTS.map((option, index) => (
              <text
                key={option.value}
                content={index === selectedIndex ? ` ▶ ${option.label}` : `   ${option.label}`}
                style={{
                  fg: index === selectedIndex ? assistantMarkerFg : textFg,
                }}
              />
            ))}
          </box>
          <text content="↑↓ pilih nominal  •  enter lanjutkan  •  esc batal" style={{ fg: mutedFg }} />
        </>
      ) : null}

      {phase === 'loading' ? (
        <text content="Menghubungkan ke payment gateway..." style={{ fg: mutedFg }} />
      ) : null}

      {phase === 'ready' && paymentData ? (
        <>
          <box style={{ width: '100%', flexDirection: 'column', paddingTop: 1 }}>
            <text content={`Order ID: ${paymentData.orderId}`} style={{ fg: textFg }} />
            <text
              content={`Jumlah: Rp ${paymentData.amountIdr.toLocaleString('id-ID')}`}
              style={{ fg: greenFg }}
            />
            {paymentData.redirectUrl ? (
              <text content={`Link: ${paymentData.redirectUrl}`} style={{ fg: assistantMarkerFg }} />
            ) : null}
            {paymentData.payInstructions ? (
              <text content={paymentData.payInstructions} style={{ fg: mutedFg }} />
            ) : null}
          </box>
          <text content="enter buka link di browser  •  esc kembali" style={{ fg: mutedFg }} />
        </>
      ) : null}

      {phase === 'error' ? (
        <>
          <text content={`Error: ${error}`} style={{ fg: redFg }} />
          <text content="esc kembali" style={{ fg: mutedFg }} />
        </>
      ) : null}
    </box>
  );
}
