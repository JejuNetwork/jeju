import DefaultTheme from 'vitepress/theme';
import NetworkSwitcher from './components/NetworkSwitcher.vue';
import ContractAddresses from './components/ContractAddresses.vue';
import NetworkInfo from './components/NetworkInfo.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('NetworkSwitcher', NetworkSwitcher);
    app.component('ContractAddresses', ContractAddresses);
    app.component('NetworkInfo', NetworkInfo);
  },
};

