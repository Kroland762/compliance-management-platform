import { QuestionItem } from '../models';
import { decrypt } from '../utils/crypto';

class ReviewService {
  async getReviewData(taskId: string) {
    const items = await QuestionItem.findAll({
      where: { taskId },
      include: [
        { association: 'asset' },
        { association: 'evidenceFiles', where: { status: 'active' }, required: false },
      ],
      order: [['sequenceNumber', 'ASC'], ['assetId', 'ASC']],
    });
    return items.map((item) => {
      const json: any = item.toJSON();
      json.evidenceFiles = (json.evidenceFiles || []).map(
        ({ filePath: _path, storedFilename: _stored, storageKey: _key, ...safe }: any) => safe,
      );
      if (json.currentStatusDescription) json.currentStatusDescription = decrypt(json.currentStatusDescription);
      json.selfReview = Boolean(item.reviewedBy && item.reviewedBy === item.assignedTo);
      return json;
    });
  }
}

export default new ReviewService();
