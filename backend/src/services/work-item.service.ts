import { Op } from 'sequelize';
import {
  AssessmentAuditor,
  AssessmentAsset,
  EvaluationAsset,
  EvaluationWorkflowStatus,
  QuestionItem,
  RemediationAction,
  RemediationActionStatus,
  VerificationStatus,
} from '../models';

type RequestUser = NonNullable<Express.Request['user']>;

class WorkItemService {
  async list(user: RequestUser) {
    const auditorAssignments = await AssessmentAuditor.findAll({
      where: { auditorUserId: user.userId },
      attributes: ['taskId'],
      raw: true,
    });
    const auditorTaskIds = auditorAssignments.map((item: any) => item.taskId);
    const reviewTaskWhere = { taskId: { [Op.in]: auditorTaskIds } };

    const [fill, review, remediate, candidateActions] = await Promise.all([
      QuestionItem.findAll({
        where: {
          assignedTo: user.userId,
          workflowStatus: { [Op.in]: [
            EvaluationWorkflowStatus.PENDING,
            EvaluationWorkflowStatus.IN_PROGRESS,
            EvaluationWorkflowStatus.RETURNED,
          ] },
        },
        include: [
          { association: 'task', attributes: ['id', 'name', 'status', ['periodEnd', 'dueDate']] },
          { association: 'evaluationAssets' },
        ],
        order: [['taskId', 'ASC'], ['sequenceNumber', 'ASC']],
      }),
      QuestionItem.findAll({
        where: {
          ...reviewTaskWhere,
          workflowStatus: EvaluationWorkflowStatus.SUBMITTED,
          [Op.or]: [{ reviewClaimedBy: null }, { reviewClaimedBy: user.userId }],
        },
        include: [
          { association: 'task', attributes: ['id', 'name', 'status', ['periodEnd', 'dueDate']] },
          { association: 'evaluationAssets' },
        ],
        order: [['submittedAt', 'ASC']],
      }),
      RemediationAction.findAll({
        where: {
          ownerUserId: user.userId,
          status: { [Op.in]: [RemediationActionStatus.NOT_STARTED, RemediationActionStatus.IN_PROGRESS] },
        },
        include: [
          { association: 'riskLinks', include: [{ association: 'risk', attributes: ['id', 'code', 'title', 'taskId'] }] },
          { association: 'findingLinks', include: [{ association: 'finding', attributes: ['id', 'code', 'title', 'taskId'] }] },
        ],
        order: [['dueDate', 'ASC']],
      }),
      RemediationAction.findAll({
        where: { status: RemediationActionStatus.PENDING_VERIFICATION },
        include: [
          {
            association: 'riskLinks',
            where: { verificationStatus: VerificationStatus.PENDING },
            required: false,
            include: [{ association: 'risk', attributes: ['id', 'code', 'title', 'taskId'] }],
          },
          {
            association: 'findingLinks',
            where: { verificationStatus: VerificationStatus.PENDING },
            required: false,
            include: [{ association: 'finding', attributes: ['id', 'code', 'title', 'taskId'] }],
          },
        ],
        order: [['submittedAt', 'ASC']],
      }),
    ]);

    const visibleVerificationActions: RemediationAction[] = [];
    for (const action of candidateActions) {
      if (action.ownerUserId === user.userId) continue;
      const json: any = action.toJSON();
      const riskLinks = (json.riskLinks || []).filter((link: any) => auditorTaskIds.includes(link.risk?.taskId));
      const findingLinks = (json.findingLinks || []).filter((link: any) => auditorTaskIds.includes(link.finding?.taskId));
      if (riskLinks.length || findingLinks.length) {
        action.setDataValue('riskLinks' as any, riskLinks);
        action.setDataValue('findingLinks' as any, findingLinks);
        visibleVerificationActions.push(action);
      }
    }

    const evaluationItems = [...fill, ...review];
    const evaluationLinks = evaluationItems.flatMap((item: any) => (item.evaluationAssets || []) as EvaluationAsset[]);
    const snapshots = evaluationItems.length ? await AssessmentAsset.findAll({
      where: {
        taskId: { [Op.in]: [...new Set(evaluationItems.map((item) => item.taskId))] },
        assetId: { [Op.in]: [...new Set(evaluationLinks.map((link) => link.assetId))] },
      },
    }) : [];
    const snapshotMap = new Map(snapshots.map((snapshot) => [`${snapshot.taskId}:${snapshot.assetId}`, snapshot]));
    const withSnapshot = (item: QuestionItem) => {
      const rowLinks = ((item as any).evaluationAssets || []) as EvaluationAsset[];
      const itemSnapshots = rowLinks.map((link) => snapshotMap.get(`${item.taskId}:${link.assetId}`)).filter(Boolean) as AssessmentAsset[];
      return {
        ...item.toJSON(),
        assets: itemSnapshots.map((snapshot) => ({ id: snapshot.assetId, code: snapshot.assetCodeSnapshot,
          name: snapshot.assetNameSnapshot, assetType: snapshot.assetTypeSnapshot,
          ownerDepartmentId: snapshot.ownerDepartmentIdSnapshot, ownerDepartmentName: snapshot.ownerDepartmentNameSnapshot })),
        asset: itemSnapshots[0] ? { id: itemSnapshots[0].assetId, code: itemSnapshots[0].assetCodeSnapshot,
          name: itemSnapshots[0].assetNameSnapshot, assetType: itemSnapshots[0].assetTypeSnapshot,
          ownerDepartmentId: itemSnapshots[0].ownerDepartmentIdSnapshot, ownerDepartmentName: itemSnapshots[0].ownerDepartmentNameSnapshot } : null,
      };
    };

    return {
      fill: fill.map(withSnapshot),
      review: review.map(withSnapshot),
      remediate,
      verify: visibleVerificationActions,
      counts: {
        fill: fill.length,
        review: review.length,
        remediate: remediate.length,
        verify: visibleVerificationActions.length,
      },
    };
  }
}

export default new WorkItemService();
