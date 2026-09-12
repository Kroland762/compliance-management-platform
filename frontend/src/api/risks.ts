import apiClient from './client';

export const riskApi = {
  create: (data: unknown, idempotencyKey: string) => apiClient.post('/risks', data, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }),
  detail: (id: string) => apiClient.get(`/risks/${id}`),
  update: (id: string, data: unknown, lockVersion: number) => apiClient.patch(`/risks/${id}`, data, {
    headers: { 'If-Match': `"${lockVersion}"` },
  }),
  assignReviewer: (id: string, reviewerUserId: string, lockVersion: number) => apiClient.put(`/risks/${id}/reviewer`, { reviewerUserId }, {
    headers: { 'If-Match': `"${lockVersion}"` },
  }),
};
