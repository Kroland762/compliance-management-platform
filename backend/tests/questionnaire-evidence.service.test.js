import { afterEach, describe, expect, test, vi } from 'vitest';
import { config } from '../src/config';
import questionnaireService from '../src/services/questionnaire.service';
import { AuditTask, EvidenceFile, EvidenceType, QuestionItem } from '../src/models';

const originalLegacyDir = config.upload.legacyEvidenceDir;

describe('questionnaire historical evidence integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    config.upload.legacyEvidenceDir = originalLegacyDir;
  });

  test('returns current and historical evidence in separate response fields', async () => {
    vi.spyOn(QuestionItem, 'findAll').mockResolvedValue([{
      historicalEvidencePath: '/uploads/history.pdf',
      toJSON: () => ({
        id: 'question-1',
        currentStatusDescription: null,
        evidenceFiles: [
          { id: 'current-1', evidenceType: EvidenceType.CURRENT, originalFilename: 'current.png' },
          { id: 'history-1', evidenceType: EvidenceType.HISTORICAL, originalFilename: 'history.pdf' },
        ],
      }),
    }]);

    const questions = await questionnaireService.getQuestions('task-1');

    expect(questions[0].evidenceFiles).toHaveLength(1);
    expect(questions[0].evidenceFiles[0].id).toBe('current-1');
    expect(questions[0].historicalEvidence.id).toBe('history-1');
  });

  test('migrates legacy history paths idempotently with the task creator as uploader', async () => {
    config.upload.legacyEvidenceDir = '/missing';
    const item = { id: 'question-1', taskId: 'task-1', historicalEvidencePath: '/missing/legacy.pdf' };
    vi.spyOn(QuestionItem, 'findAll').mockResolvedValue([item]);
    vi.spyOn(EvidenceFile, 'findOne').mockResolvedValue(null);
    vi.spyOn(AuditTask, 'findByPk').mockResolvedValue({ createdBy: 'creator-1' });
    const create = vi.spyOn(EvidenceFile, 'create').mockResolvedValue({ id: 'history-1' });

    const result = await questionnaireService.migrateLegacyHistoricalEvidence();

    expect(result).toEqual({ migrated: 1, skipped: 0, failed: 0 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      questionItemId: 'question-1',
      evidenceType: EvidenceType.HISTORICAL,
      originalFilename: 'legacy.pdf',
      filePath: '/missing/legacy.pdf',
      uploadedBy: 'creator-1',
    }));
  });
});
