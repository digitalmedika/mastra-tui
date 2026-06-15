import { useEffect, useState } from 'react';
import { SPINNER_FRAMES } from '../constants';

export function StreamingIndicator() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <text content={` ${SPINNER_FRAMES[frame]} `} style={{ fg: '#00d9ff', attributes: 'bold' as any }} />
  );
}
