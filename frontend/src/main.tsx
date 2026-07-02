import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './assets/global.css';

const appleTheme = {
  token: {
    colorPrimary: '#007AFF',
    colorSuccess: '#34C759',
    colorWarning: '#FF9500',
    colorError: '#FF3B30',
    colorInfo: '#007AFF',
    colorTextBase: '#1D1D1F',
    colorBgBase: '#FFFFFF',
    borderRadius: 12,
    borderRadiusLG: 18,
    borderRadiusSM: 8,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    fontSize: 14,
    fontSizeHeading1: 34,
    fontSizeHeading2: 28,
    fontSizeHeading3: 22,
    fontSizeHeading4: 18,
    lineHeight: 1.5,
    controlHeight: 36,
    controlHeightLG: 44,
    paddingContentHorizontal: 24,
    paddingContentVertical: 20,
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    boxShadowSecondary: '0 4px 12px rgba(0,0,0,0.06)',
    wireframe: false,
  },
  components: {
    Button: {
      borderRadius: 10,
      controlHeight: 36,
      controlHeightLG: 44,
      paddingContentHorizontal: 20,
      fontWeight: 500,
    },
    Card: {
      borderRadiusLG: 18,
      paddingLG: 24,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    },
    Table: {
      borderRadius: 12,
      headerBg: '#FAFAFA',
      headerColor: '#6E6E73',
      rowHoverBg: '#F5F5F7',
      borderColor: '#F0F0F0',
    },
    Input: {
      borderRadius: 10,
      controlHeight: 36,
      controlHeightLG: 44,
      activeShadow: '0 0 0 2px rgba(0,122,255,0.15)',
    },
    Select: {
      borderRadius: 10,
      controlHeight: 36,
    },
    Menu: {
      itemBorderRadius: 8,
      itemHeight: 38,
      horizontalItemHoverColor: '#F5F5F7',
    },
    Modal: {
      borderRadiusLG: 18,
      paddingLG: 24,
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Layout: {
      headerBg: 'rgba(255,255,255,0.72)',
      headerHeight: 56,
      bodyBg: '#F5F5F7',
      siderBg: 'rgba(255,255,255,0.85)',
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={appleTheme}>
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
