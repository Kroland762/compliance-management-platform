import { useState } from 'react';
import { Modal, Descriptions, Button, Form, Input, message, Avatar, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useAuthStore } from '../store/auth';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';

const { Text } = Typography;

interface ProfileProps {
  open: boolean;
  onClose: () => void;
}

export default function ProfileModal({ open, onClose }: ProfileProps) {
  const user = useAuthStore((s) => s.user);
  const [pwdVisible, setPwdVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const roleLabel = user?.role || '—';

  const handleChangePassword = async (values: any) => {
    setLoading(true);
    try {
      await apiClient.put('/profile/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      message.success('密码修改成功，下次登录时生效');
      setPwdVisible(false);
      form.resetFields();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '修改失败'));
    } finally { setLoading(false); }
  };

  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      width={420}
      closable
      styles={{ body: { padding: '28px 32px' } }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Avatar size={56} style={{ backgroundColor: '#007AFF', fontSize: 22, flexShrink: 0 }}>
          {user?.username?.[0]?.toUpperCase()}
        </Avatar>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#1D1D1F', letterSpacing: '-0.02em' }}>
            {user?.username}
          </div>
          <Text style={{ color: '#8E8E93', fontSize: 13 }}>{roleLabel}</Text>
        </div>
      </div>

      {/* Info */}
      <div style={{
        background: 'rgba(0,0,0,0.02)',
        borderRadius: 14,
        padding: '16px 20px',
        marginBottom: 20,
      }}>
        <Descriptions column={1} size="small" labelStyle={{ color: '#8E8E93', fontSize: 12 }} contentStyle={{ fontSize: 14 }}>
          <Descriptions.Item label="用户名">{user?.username}</Descriptions.Item>
          <Descriptions.Item label="角色">{roleLabel}</Descriptions.Item>
          <Descriptions.Item label="部门">{user?.department || '未设置'}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{user?.email || '未设置'}</Descriptions.Item>
        </Descriptions>
      </div>

      {/* Change password */}
      {!pwdVisible ? (
        <Button icon={<LockOutlined />} onClick={() => setPwdVisible(true)} block style={{ borderRadius: 10 }}>
          修改密码
        </Button>
      ) : (
        <Form form={form} layout="vertical" onFinish={handleChangePassword} style={{ marginTop: 8 }}>
          <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
            <Input.Password size="middle" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[
            { required: true, message: '请输入新密码' },
            { min: 8, message: '密码长度不能少于8位' },
          ]}>
            <Input.Password size="middle" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}>
            <Input.Password size="middle" style={{ borderRadius: 10 }} />
          </Form.Item>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => { setPwdVisible(false); form.resetFields(); }} style={{ borderRadius: 10, flex: 1 }}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={loading} style={{ borderRadius: 10, flex: 1, fontWeight: 500 }}>
              确认修改
            </Button>
          </div>
        </Form>
      )}
    </Modal>
  );
}
