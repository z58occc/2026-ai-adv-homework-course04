const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const orders = ref([]);
    const pagination = ref(null);
    const loading = ref(true);
    const errorMessage = ref('');

    const statusMap = {
      pending: { label: '待付款', cls: 'bg-apricot/20 text-apricot' },
      paid: { label: '已付款', cls: 'bg-sage/20 text-sage' },
      failed: { label: '付款失敗', cls: 'bg-red-100 text-red-600' },
    };

    // API 每頁預設 10 筆，需要換頁才看得到較舊的訂單
    async function loadPage(page) {
      loading.value = true;
      errorMessage.value = '';
      try {
        const res = await apiFetch('/api/orders?page=' + page);
        orders.value = res.data.orders;
        pagination.value = res.data.pagination;
      } catch (e) {
        // 失敗時保留目前這一頁與換頁控制，使用者可以直接重試，不必重新整理
        errorMessage.value = '訂單載入失敗，請稍後再試';
      } finally {
        loading.value = false;
        window.scrollTo({ top: 0 });
      }
    }

    onMounted(function () {
      loadPage(1);
    });

    return { orders, pagination, loading, errorMessage, statusMap, formatDate, loadPage };
  }
}).mount('#app');
