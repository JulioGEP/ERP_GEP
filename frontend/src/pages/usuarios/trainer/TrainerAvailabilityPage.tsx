// frontend/src/pages/usuarios/trainer/TrainerAvailabilityPage.tsx
import { Stack } from 'react-bootstrap';
import { TrainerAvailabilitySection } from '../../../features/recursos/TrainerAvailabilitySection';

export default function TrainerAvailabilityPage() {
  return (
    <Stack gap={4} className="trainer-availability-page">
      <TrainerAvailabilitySection />
    </Stack>
  );
}
