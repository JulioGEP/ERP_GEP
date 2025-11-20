import { useEffect, useMemo, useState } from 'react';

import {
  getTrainingTemplatesManager,
  type TrainingTemplate,
} from '../features/certificados/lib/templates/training-templates';

function formatTemplatePoints(template: TrainingTemplate): string | null {
  const duration = template.duration?.trim();
  const theory = Array.isArray(template.theory)
    ? template.theory.map((entry) => entry?.trim?.()).filter((entry): entry is string => Boolean(entry))
    : [];
  const practice = Array.isArray(template.practice)
    ? template.practice.map((entry) => entry?.trim?.()).filter((entry): entry is string => Boolean(entry))
    : [];

  const parts: string[] = [];
  if (duration?.length) {
    parts.push(`Duración: ${duration}`);
  }
  if (theory.length) {
    parts.push(`Teoría: ${theory.join('; ')}`);
  }
  if (practice.length) {
    parts.push(`Práctica: ${practice.join('; ')}`);
  }

  return parts.length ? parts.join(' | ') : null;
}

export function useTrainingTemplatePoints(templateId: string | null | undefined): string | null {
  const [points, setPoints] = useState<string | null>(null);

  const normalizedId = useMemo(() => templateId?.trim() || null, [templateId]);

  useEffect(() => {
    let cancelled = false;

    const loadPoints = async () => {
      if (!normalizedId) {
        setPoints(null);
        return;
      }

      const template = await getTrainingTemplatesManager().getTemplateById(normalizedId);
      if (cancelled) return;
      setPoints(template ? formatTemplatePoints(template) : null);
    };

    void loadPoints();

    return () => {
      cancelled = true;
    };
  }, [normalizedId]);

  return points;
}
