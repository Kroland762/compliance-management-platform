import { useCallback } from 'react';
import apiClient from '../api/client';

/**
 * 刷新题目列表，同时保留当前已编辑但未保存的内容
 */
export default function useQuestionsSync(taskId: string | undefined) {
  const refreshQuestions = useCallback(
    async (prevQuestions: any[]): Promise<any[]> => {
      if (!taskId) return prevQuestions;
      try {
        const res: any = await apiClient.get(`/tasks/${taskId}/questions`);
        const fresh = res.data?.questions || [];
        return fresh.map((fq: any) => {
          const local = prevQuestions.find((q: any) => q.id === fq.id);
          if (local?.currentStatusDescription !== undefined) {
            return { ...fq, currentStatusDescription: local.currentStatusDescription, answerStatus: local.answerStatus };
          }
          return fq;
        });
      } catch {
        return prevQuestions;
      }
    },
    [taskId],
  );

  return refreshQuestions;
}
