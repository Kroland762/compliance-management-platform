import { useState, useEffect } from 'react';
import { Table, Button, Space, Modal, Upload, message, Popconfirm, Popover, Checkbox } from 'antd';
import { UploadOutlined, DeleteOutlined, EyeOutlined, SettingOutlined, CaretLeftOutlined, CaretRightOutlined } from '@ant-design/icons';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';


export default function TemplateManagement() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [importVisible, setImportVisible] = useState(false);
  const [importName, setImportName] = useState('');
  const [columnOrder, setColumnOrder] = useState<string[]>(['sequenceNumber', 'controlDomain', 'controlPoint']);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res: any = await apiClient.get('/templates');
      setTemplates(res.data?.items || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleDelete = async (id: string) => {
    try {
      await apiClient.delete(`/templates/${id}`);
      message.success('模版已删除');
      fetchTemplates();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '删除失败'));
    }
  };

  const handleView = async (id: string) => {
    try {
      const res: any = await apiClient.get(`/templates/${id}`);
      setSelectedTemplate(res.data);
      setDetailVisible(true);
    } catch { message.error('获取详情失败'); }
  };

  const handleImport = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', importName || file.name.replace('.csv', ''));
    try {
      const res: any = await apiClient.post('/templates/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success(res.message || '导入成功');
      setImportVisible(false);
      setImportName('');
      fetchTemplates();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '导入失败'));
    }
    return false; // prevent default upload
  };

  const columns = [
    { title: '模版名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description' },
    { title: '题目数量', dataIndex: 'questionCount', key: 'questionCount' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'actions', render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(record.id)}>详情</Button>
          <Popconfirm title="确定删除此模版？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{
        background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 18, padding: '24px 28px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div />
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setImportVisible(true)}>导入CSV模版</Button>
        </div>
        <Table columns={columns} dataSource={templates} rowKey="id" loading={loading} size="small" />
      </div>

      <Modal title="导入CSV模版" open={importVisible} onCancel={() => setImportVisible(false)} footer={null}>
        <div style={{ marginBottom: 16 }}>
          <span>模版名称：</span>
          <input value={importName} onChange={e => setImportName(e.target.value)} placeholder="输入模版名称" style={{ marginLeft: 8, padding: '4px 8px', width: 200 }} />
        </div>
        <Upload accept=".csv" beforeUpload={handleImport} maxCount={1}>
          <Button icon={<UploadOutlined />}>选择CSV文件</Button>
        </Upload>
      </Modal>

      <Modal title="模版详情" open={detailVisible} onCancel={() => setDetailVisible(false)} width="90%" style={{ top: 20 }} footer={null}>
        {selectedTemplate && (() => {
          const questions = selectedTemplate.templateQuestions || selectedTemplate.questions || [];
          // 动态列：基础三列 + 从 extraData 提取的额外列
          const baseColumns = [
            { title: '序号', dataIndex: 'sequenceNumber', width: 140 },
            { title: '控制域名', dataIndex: 'controlDomain', width: 240 },
            { title: '控制点', dataIndex: 'controlPoint', ellipsis: true },
          ];
          // 检查是否有 extraData
          const extraKeys: string[] = [];
          if (questions.length > 0 && questions[0].extraData) {
            Object.keys(questions[0].extraData).forEach(k => extraKeys.push(k));
          }
          const extraColumns = extraKeys.map(k => ({
            title: k, dataIndex: ['extraData', k], width: 160,
            render: (v: any) => v || '-',
          }));
          const allColDefs: any = {
            sequenceNumber: { title: '序号', dataIndex: 'sequenceNumber', width: 140 },
            controlDomain: { title: '控制域名', dataIndex: 'controlDomain', width: 240 },
            controlPoint: { title: '控制点', dataIndex: 'controlPoint', ellipsis: true },
            ...Object.fromEntries(extraColumns.map(c => [String(c.dataIndex[1]), c])),
          };
          const allColumns = columnOrder.filter(k => allColDefs[k]).map(k => allColDefs[k]);

          return (
          <Table
            dataSource={questions}
            size="small"
            rowKey="id"
            columns={allColumns}
            pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 题` }}
            scroll={{ x: 800 + extraKeys.length * 160 }}
            size="small"
            title={() => (
              <Popover
                content={
                  <div>
                    {Object.entries(allColDefs).map(([key, col]: [string, any]) => {
                      const curIdx = columnOrder.indexOf(key);
                      const isVisible = curIdx !== -1;
                      const canMoveLeft = isVisible && curIdx > 0;
                      const canMoveRight = isVisible && curIdx < columnOrder.length - 1;

                      const moveLeft = () => {
                        if (!canMoveLeft) return;
                        const newOrder = [...columnOrder];
                        [newOrder[curIdx], newOrder[curIdx - 1]] = [newOrder[curIdx - 1], newOrder[curIdx]];
                        setColumnOrder(newOrder);
                      };

                      const moveRight = () => {
                        if (!canMoveRight) return;
                        const newOrder = [...columnOrder];
                        [newOrder[curIdx], newOrder[curIdx + 1]] = [newOrder[curIdx + 1], newOrder[curIdx]];
                        setColumnOrder(newOrder);
                      };

                      return (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0', userSelect: 'none' }}>
                          <CaretLeftOutlined
                            style={{ fontSize: 11, color: canMoveLeft ? '#007AFF' : '#D1D1D6', cursor: canMoveLeft ? 'pointer' : 'not-allowed' }}
                            onClick={moveLeft}
                          />
                          <CaretRightOutlined
                            style={{ fontSize: 11, color: canMoveRight ? '#007AFF' : '#D1D1D6', cursor: canMoveRight ? 'pointer' : 'not-allowed' }}
                            onClick={moveRight}
                          />
                          <Checkbox checked={isVisible} onChange={e => {
                            if (e.target.checked) {
                              if (!isVisible) {
                                // 插到前一个可见列的后面
                                const newOrder = [...columnOrder];
                                const prevKey = Object.keys(allColDefs).slice(0, Object.keys(allColDefs).indexOf(key)).reverse().find(k => newOrder.includes(k));
                                const insertIdx = prevKey ? newOrder.indexOf(prevKey) + 1 : 0;
                                newOrder.splice(insertIdx, 0, key);
                                setColumnOrder(newOrder);
                              }
                            } else {
                              setColumnOrder(columnOrder.filter(k => k !== key));
                            }
                          }}>
                            {col.title as string}
                          </Checkbox>
                        </div>
                      );
                    })}
                  </div>
                }
                trigger="click"
              >
                <Button size="small" icon={<SettingOutlined />}>列设置</Button>
              </Popover>
            )}
          />
          );
        })()}
      </Modal>
    </div>
  );
}
