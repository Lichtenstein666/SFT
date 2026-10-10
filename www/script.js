// Данные приложения
const DEFAULT_CATEGORIES = {
    expense: {
        'Продукты': ['магазин', 'супермаркет', 'продукты', 'пятерочка', 'магнит', 'перекресток', 'ашан'],
        'Транспорт': ['такси', 'яндекс', 'uber', 'метро', 'автобус', 'азс', 'заправка'],
        'Рестораны': ['ресторан', 'кафе', 'макдоналдс', 'kfc', 'бургер', 'пицца'],
        'Развлечения': ['кино', 'театр', 'концерт', 'игры', 'steam'],
        'Коммунальные': ['жкх', 'электричество', 'вода', 'газ', 'интернет'],
        'Здоровье': ['аптека', 'клиника', 'больница', 'врач'],
        'Одежда': ['одежда', 'обувь', 'zara'],
        'Прочее': []
    },
    income: {
        'Зарплата': ['зарплата', 'оклад'],
        'Переводы': ['перевод', 'пополнение'],
        'Другие доходы': []
    }
};

let transactions = [];
let categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
let cashBalance = 0;
let cashHistory = [];
let debt = 0;
let editingTransactionId = null;
let balanceChart = null;
let detailedChart = null;
let currentChartView = 'overview'; // 'overview' | 'detailed'
let selectedChartCategories = []; // выбранные категории для детального графика

// Профили
let profiles = {};
let currentProfileId = null;
let editingProfileId = null;
let isSectionAnimating = false;

function detectProfileType(name, explicitType) {
    if (explicitType === 'credit' || explicitType === 'debit') return explicitType;
    const n = (name || '').toLowerCase();
    if (n.indexOf('кредит') !== -1) return 'credit';
    return 'debit';
}

function isCreditProfile(profile) {
    if (!profile) return false;
    return detectProfileType(profile.name, profile.type) === 'credit';
}

function isCurrentCreditProfile() {
    return isCreditProfile(profiles[currentProfileId]);
}

let openingDebt = 0;

function getCardDebtDelta() {
    const cardTx = transactions.filter(t => t.paymentMethod === 'card');
    const totalExpense = cardTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const totalIncome = cardTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    return totalExpense - totalIncome;
}

function recalculateDebtFromTransactions() {
    if (!isCurrentCreditProfile()) {
        debt = 0;
        return 0;
    }
    // Долг = начальный долг + расходы по карте − поступления (погашения)
    debt = Math.max(0, (openingDebt || 0) + getCardDebtDelta());
    return debt;
}

/** Установить отображаемый долг; пересчитывает openingDebt относительно текущих транзакций */
function setDisplayedDebt(targetAmount) {
    const target = Math.max(0, parseFloat(targetAmount) || 0);
    openingDebt = target - getCardDebtDelta();
    debt = target;
    return debt;
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    loadProfiles();
    loadData();
    initNavigation();
    initProfilesUI();
    initFileUpload();
    initModals();
    initCategoryTabs();
    initFilters();
    updateAllUI();
    updateProfileUI();
});

// ——— Профили ———

function createEmptyProfileData() {
    return {
        transactions: [],
        categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
        cashBalance: 0,
        cashHistory: [],
        debt: 0,
        openingDebt: 0
    };
}

function generateProfileId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function loadProfiles() {
    try {
        const savedProfiles = localStorage.getItem('financeProfiles');
        const savedCurrent = localStorage.getItem('currentProfileId');

        if (savedProfiles) {
            profiles = JSON.parse(savedProfiles);
        }

        // Миграция старых данных (без профилей) → профиль «Личный»
        const legacyTx = localStorage.getItem('transactions');
        if ((!profiles || Object.keys(profiles).length === 0) && legacyTx) {
            const id = generateProfileId();
            profiles = {};
            profiles[id] = {
                id: id,
                name: 'Личный',
                createdAt: Date.now(),
                data: {
                    transactions: JSON.parse(legacyTx || '[]'),
                    categories: JSON.parse(localStorage.getItem('categories') || JSON.stringify(DEFAULT_CATEGORIES)),
                    cashBalance: parseFloat(localStorage.getItem('cashBalance') || '0') || 0,
                    cashHistory: JSON.parse(localStorage.getItem('cashHistory') || '[]')
                }
            };
            currentProfileId = id;
            persistProfiles();
        }

        if (!profiles || Object.keys(profiles).length === 0) {
            const id = generateProfileId();
            profiles = {};
            profiles[id] = {
                id: id,
                name: 'Личный',
                createdAt: Date.now(),
                data: createEmptyProfileData()
            };
            currentProfileId = id;
            persistProfiles();
        }

        if (savedCurrent && profiles[savedCurrent]) {
            currentProfileId = savedCurrent;
        } else {
            currentProfileId = Object.keys(profiles)[0];
        }
    } catch (e) {
        console.error('Ошибка загрузки профилей:', e);
        const id = generateProfileId();
        profiles = {};
        profiles[id] = {
            id: id,
            name: 'Личный',
            createdAt: Date.now(),
            data: createEmptyProfileData()
        };
        currentProfileId = id;
    }
}

function persistProfiles() {
    try {
        localStorage.setItem('financeProfiles', JSON.stringify(profiles));
        localStorage.setItem('currentProfileId', currentProfileId);
    } catch (e) {
        console.error('Ошибка сохранения профилей:', e);
    }
}

function loadData() {
    try {
        const profile = profiles[currentProfileId];
        if (!profile || !profile.data) {
            transactions = [];
            categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
            cashBalance = 0;
            cashHistory = [];
            debt = 0;
            openingDebt = 0;
            return;
        }
        // Автоопределение типа для существующих профилей (Дебетовая / Кредитка)
        if (!profile.type) {
            profile.type = detectProfileType(profile.name);
        }
        const d = profile.data;
        transactions = Array.isArray(d.transactions) ? d.transactions : [];
        categories = d.categories || JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
        cashBalance = typeof d.cashBalance === 'number' ? d.cashBalance : (parseFloat(d.cashBalance) || 0);
        cashHistory = Array.isArray(d.cashHistory) ? d.cashHistory : [];
        openingDebt = typeof d.openingDebt === 'number' ? d.openingDebt : (parseFloat(d.openingDebt) || 0);
        if (isCreditProfile(profile)) {
            // Если долг ещё ни разу не задавали вручную, а в data.debt уже есть значение — подстроим openingDebt
            if ((d.openingDebt === undefined || d.openingDebt === null) && typeof d.debt === 'number' && d.debt > 0) {
                openingDebt = d.debt - getCardDebtDelta();
            }
            recalculateDebtFromTransactions();
        } else {
            debt = 0;
            openingDebt = 0;
        }
    } catch (e) {
        console.error('Ошибка загрузки данных профиля:', e);
    }
}

function saveData() {
    try {
        if (!currentProfileId || !profiles[currentProfileId]) return;
        if (isCurrentCreditProfile()) {
            recalculateDebtFromTransactions();
        }
        profiles[currentProfileId].data = {
            transactions: transactions,
            categories: categories,
            cashBalance: cashBalance,
            cashHistory: cashHistory,
            debt: debt,
            openingDebt: openingDebt
        };
        persistProfiles();
        // Совместимость со старым форматом
        localStorage.setItem('transactions', JSON.stringify(transactions));
        localStorage.setItem('categories', JSON.stringify(categories));
        localStorage.setItem('cashBalance', cashBalance.toString());
        localStorage.setItem('cashHistory', JSON.stringify(cashHistory));
    } catch (e) {
        console.error('Ошибка сохранения данных:', e);
    }
}

function switchProfile(profileId) {
    if (!profiles[profileId] || profileId === currentProfileId) {
        closeProfileDropdown();
        return;
    }
    saveData();
    currentProfileId = profileId;
    persistProfiles();
    loadData();
    if (balanceChart) {
        balanceChart.destroy();
        balanceChart = null;
    }
    if (detailedChart) {
        detailedChart.destroy();
        detailedChart = null;
    }
    selectedChartCategories = [];
    updateAllUI();
    updateProfileUI();
    closeProfileDropdown();
}

function createProfile(name, type) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const id = generateProfileId();
    const profileType = detectProfileType(trimmed, type);
    profiles[id] = {
        id: id,
        name: trimmed,
        type: profileType,
        createdAt: Date.now(),
        data: createEmptyProfileData()
    };
    persistProfiles();
    switchProfile(id);
}

function renameProfile(profileId, newName, type) {
    const trimmed = (newName || '').trim();
    if (!trimmed || !profiles[profileId]) return;
    profiles[profileId].name = trimmed;
    if (type === 'credit' || type === 'debit') {
        profiles[profileId].type = type;
    } else {
        profiles[profileId].type = detectProfileType(trimmed, profiles[profileId].type);
    }
    persistProfiles();
    if (profileId === currentProfileId) {
        loadData();
        updateAllUI();
    }
    updateProfileUI();
    renderProfilesManageList();
}

function deleteProfile(profileId) {
    const ids = Object.keys(profiles);
    if (ids.length <= 1) {
        alert('Нельзя удалить единственный профиль');
        return;
    }
    if (!confirm('Удалить профиль «' + profiles[profileId].name + '» и все его данные?')) {
        return;
    }
    delete profiles[profileId];
    if (currentProfileId === profileId) {
        currentProfileId = Object.keys(profiles)[0];
        loadData();
        if (balanceChart) {
            balanceChart.destroy();
            balanceChart = null;
        }
        if (detailedChart) {
            detailedChart.destroy();
            detailedChart = null;
        }
        selectedChartCategories = [];
        updateAllUI();
    }
    persistProfiles();
    updateProfileUI();
    renderProfilesManageList();
}

function getProfileInitial(name) {
    const t = (name || '?').trim();
    return t.charAt(0).toUpperCase();
}

function updateProfileUI() {
    const profile = profiles[currentProfileId];
    const nameEl = document.getElementById('profileNameLabel');
    const avatarEl = document.getElementById('profileAvatar');
    if (profile) {
        if (nameEl) nameEl.textContent = profile.name;
        if (avatarEl) avatarEl.textContent = getProfileInitial(profile.name);
    }
    renderProfileList();
}

function renderProfileList() {
    const list = document.getElementById('profileList');
    if (!list) return;
    list.innerHTML = '';

    const sorted = Object.values(profiles).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    sorted.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'profile-option' + (p.id === currentProfileId ? ' active' : '');
        btn.setAttribute('role', 'option');
        btn.innerHTML =
            '<span class="profile-option-avatar">' + getProfileInitial(p.name) + '</span>' +
            '<span class="profile-option-name">' + escapeHtml(p.name) + '</span>' +
            (p.id === currentProfileId ? '<span class="profile-option-check">✓</span>' : '');
        btn.addEventListener('click', function() {
            switchProfile(p.id);
        });
        list.appendChild(btn);
    });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function openProfileDropdown() {
    const dropdown = document.getElementById('profileDropdown');
    const btn = document.getElementById('profileCurrentBtn');
    if (!dropdown || !btn) return;
    renderProfileList();
    dropdown.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('open');
}

function closeProfileDropdown() {
    const dropdown = document.getElementById('profileDropdown');
    const btn = document.getElementById('profileCurrentBtn');
    if (!dropdown || !btn) return;
    dropdown.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('open');
}

function initProfilesUI() {
    const currentBtn = document.getElementById('profileCurrentBtn');
    const addBtn = document.getElementById('addProfileBtn');
    const manageBtn = document.getElementById('manageProfilesBtn');
    const profileForm = document.getElementById('profileForm');
    const closeProfileModal = document.getElementById('closeProfileModal');
    const cancelProfile = document.getElementById('cancelProfile');
    const closeManage = document.getElementById('closeProfilesManageModal');
    const closeManageBtn = document.getElementById('closeProfilesManageBtn');

    if (currentBtn) {
        currentBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const dropdown = document.getElementById('profileDropdown');
            if (dropdown && !dropdown.hidden) {
                closeProfileDropdown();
            } else {
                openProfileDropdown();
            }
        });
    }

    document.addEventListener('click', function(e) {
        const switcher = document.querySelector('.profile-switcher');
        if (switcher && !switcher.contains(e.target)) {
            closeProfileDropdown();
        }
    });

    if (addBtn) {
        addBtn.addEventListener('click', function() {
            closeProfileDropdown();
            editingProfileId = null;
            const title = document.getElementById('profileModalTitle');
            const input = document.getElementById('profileNameInput');
            const typeInput = document.getElementById('profileTypeInput');
            if (title) title.textContent = 'Новый профиль';
            if (input) input.value = '';
            if (typeInput) typeInput.value = 'debit';
            const modal = document.getElementById('profileModal');
            if (modal) modal.classList.add('active');
            if (input) setTimeout(function() { input.focus(); }, 50);
        });
    }

    if (manageBtn) {
        manageBtn.addEventListener('click', function() {
            closeProfileDropdown();
            renderProfilesManageList();
            const modal = document.getElementById('profilesManageModal');
            if (modal) modal.classList.add('active');
        });
    }

    function closeProfileEditModal() {
        const modal = document.getElementById('profileModal');
        if (modal) modal.classList.remove('active');
        editingProfileId = null;
    }

    if (closeProfileModal) closeProfileModal.addEventListener('click', closeProfileEditModal);
    if (cancelProfile) cancelProfile.addEventListener('click', closeProfileEditModal);

    if (profileForm) {
        profileForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const input = document.getElementById('profileNameInput');
            const typeInput = document.getElementById('profileTypeInput');
            const name = input ? input.value : '';
            const type = typeInput ? typeInput.value : 'debit';
            if (editingProfileId) {
                renameProfile(editingProfileId, name, type);
            } else {
                createProfile(name, type);
            }
            closeProfileEditModal();
        });
    }

    function closeManageModal() {
        const modal = document.getElementById('profilesManageModal');
        if (modal) modal.classList.remove('active');
    }

    if (closeManage) closeManage.addEventListener('click', closeManageModal);
    if (closeManageBtn) closeManageBtn.addEventListener('click', closeManageModal);

    initPayDebtUI();
}

function renderProfilesManageList() {
    const list = document.getElementById('profilesManageList');
    if (!list) return;
    list.innerHTML = '';

    const sorted = Object.values(profiles).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    sorted.forEach(p => {
        const row = document.createElement('div');
        row.className = 'profile-manage-item' + (p.id === currentProfileId ? ' is-current' : '');
        const typeLabel = isCreditProfile(p) ? 'Кредитный' : 'Дебетовый';
        row.innerHTML =
            '<div class="profile-manage-info">' +
            '<span class="profile-option-avatar">' + getProfileInitial(p.name) + '</span>' +
            '<div><div class="profile-manage-name">' + escapeHtml(p.name) + '</div>' +
            '<div class="profile-manage-meta">' + (p.id === currentProfileId ? 'Активный · ' : '') +
            typeLabel + ' · ' +
            (Array.isArray(p.data && p.data.transactions) ? p.data.transactions.length : 0) + ' транзакций</div></div></div>' +
            '<div class="profile-manage-actions">' +
            '<button type="button" class="btn-secondary btn-sm" data-action="rename">Изменить</button>' +
            '<button type="button" class="btn-delete btn-sm" data-action="delete">Удалить</button>' +
            '</div>';

        row.querySelector('[data-action="rename"]').addEventListener('click', function() {
            editingProfileId = p.id;
            const title = document.getElementById('profileModalTitle');
            const input = document.getElementById('profileNameInput');
            const typeInput = document.getElementById('profileTypeInput');
            if (title) title.textContent = 'Переименовать профиль';
            if (input) input.value = p.name;
            if (typeInput) typeInput.value = detectProfileType(p.name, p.type);
            document.getElementById('profilesManageModal').classList.remove('active');
            document.getElementById('profileModal').classList.add('active');
            if (input) setTimeout(function() { input.focus(); }, 50);
        });

        row.querySelector('[data-action="delete"]').addEventListener('click', function() {
            deleteProfile(p.id);
        });

        list.appendChild(row);
    });
}

// Редактирование долга и погашение с дебетового счёта
function initPayDebtUI() {
    const editDebtBtn = document.getElementById('editDebtBtn');
    const editDebtModal = document.getElementById('editDebtModal');
    const editDebtForm = document.getElementById('editDebtForm');
    const closeEditDebt = document.getElementById('closeEditDebtModal');
    const cancelEditDebt = document.getElementById('cancelEditDebt');
    const openPayFromEdit = document.getElementById('openPayDebtFromEdit');

    const payModal = document.getElementById('payDebtModal');
    const payForm = document.getElementById('payDebtForm');
    const closePayBtn = document.getElementById('closePayDebtModal');
    const cancelPayBtn = document.getElementById('cancelPayDebt');

    function closeEditModal() {
        if (editDebtModal) editDebtModal.classList.remove('active');
    }

    function closePayModal() {
        if (payModal) payModal.classList.remove('active');
    }

    function openPayDebtModal() {
        if (!isCurrentCreditProfile()) return;
        recalculateDebtFromTransactions();
        const sourceSelect = document.getElementById('payDebtSourceProfile');
        const amountInput = document.getElementById('payDebtAmount');
        const dateInput = document.getElementById('payDebtDate');
        const hint = document.getElementById('payDebtHint');

        if (sourceSelect) {
            sourceSelect.innerHTML = '';
            Object.values(profiles).forEach(p => {
                if (p.id === currentProfileId) return;
                if (isCreditProfile(p)) return;
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                sourceSelect.appendChild(opt);
            });
            if (sourceSelect.options.length === 0) {
                alert('Нет дебетового профиля для погашения. Создайте дебетовый счёт.');
                return;
            }
        }
        if (amountInput) {
            amountInput.value = debt > 0 ? debt : '';
        }
        if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
        if (hint) {
            hint.textContent = debt > 0
                ? 'Текущий долг: ' + formatCurrency(debt) + '. Сумма спишется с выбранного счёта и уменьшит долг по кредитке.'
                : 'Долг сейчас 0 ₽. Можно внести предоплату — она уменьшит будущий долг.';
        }
        closeEditModal();
        if (payModal) payModal.classList.add('active');
    }

    if (editDebtBtn) {
        editDebtBtn.addEventListener('click', function() {
            if (!isCurrentCreditProfile()) return;
            recalculateDebtFromTransactions();
            const debtInput = document.getElementById('debtInput');
            if (debtInput) debtInput.value = Math.round(debt * 100) / 100;
            if (editDebtModal) editDebtModal.classList.add('active');
            if (debtInput) setTimeout(function() { debtInput.focus(); debtInput.select(); }, 50);
        });
    }

    if (closeEditDebt) closeEditDebt.addEventListener('click', closeEditModal);
    if (cancelEditDebt) cancelEditDebt.addEventListener('click', closeEditModal);
    if (openPayFromEdit) openPayFromEdit.addEventListener('click', openPayDebtModal);

    if (editDebtForm) {
        editDebtForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const debtInput = document.getElementById('debtInput');
            const value = debtInput ? parseFloat(debtInput.value) : NaN;
            if (isNaN(value) || value < 0) {
                alert('Введите корректную сумму долга');
                return;
            }
            setDisplayedDebt(value);
            saveData();
            updateAllUI();
            closeEditModal();
        });
    }

    if (closePayBtn) closePayBtn.addEventListener('click', closePayModal);
    if (cancelPayBtn) cancelPayBtn.addEventListener('click', closePayModal);

    if (payForm) {
        payForm.addEventListener('submit', function(e) {
            e.preventDefault();
            payDebtFromProfile();
        });
    }
}

function payDebtFromProfile() {
    if (!isCurrentCreditProfile()) {
        alert('Погашение доступно только для кредитного профиля');
        return;
    }

    const sourceSelect = document.getElementById('payDebtSourceProfile');
    const amountInput = document.getElementById('payDebtAmount');
    const dateInput = document.getElementById('payDebtDate');

    const sourceId = sourceSelect ? sourceSelect.value : '';
    const amount = amountInput ? parseFloat(amountInput.value) : 0;
    const date = dateInput ? dateInput.value : new Date().toISOString().split('T')[0];

    if (!sourceId || !profiles[sourceId]) {
        alert('Выберите счёт списания');
        return;
    }
    if (isCreditProfile(profiles[sourceId])) {
        alert('Списание возможно только с дебетового счёта');
        return;
    }
    if (!amount || amount <= 0) {
        alert('Введите корректную сумму');
        return;
    }

    const creditProfileId = currentProfileId;
    const creditName = profiles[creditProfileId].name;
    const sourceName = profiles[sourceId].name;

    // 1. Сохраняем текущий (кредитный) профиль
    saveData();

    // 2. Добавляем доход (погашение) на кредитку — уменьшает долг
    const creditPayment = {
        id: Date.now(),
        description: 'Погашение с «' + sourceName + '»',
        amount: amount,
        date: date,
        type: 'income',
        category: 'Переводы',
        paymentMethod: 'card',
        isDebtPayment: true,
        fromProfileId: sourceId
    };
    transactions.push(creditPayment);
    recalculateDebtFromTransactions();
    saveData();

    // 3. Добавляем расход на дебетовый профиль
    const sourceProfile = profiles[sourceId];
    if (!sourceProfile.data) sourceProfile.data = createEmptyProfileData();
    if (!Array.isArray(sourceProfile.data.transactions)) sourceProfile.data.transactions = [];

    // Убедимся, что есть категория для перевода
    if (!sourceProfile.data.categories) {
        sourceProfile.data.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    }
    if (!sourceProfile.data.categories.expense) sourceProfile.data.categories.expense = {};
    if (!sourceProfile.data.categories.expense['Кредит']) {
        sourceProfile.data.categories.expense['Кредит'] = ['кредит', 'погашение', 'кредитка'];
    }

    sourceProfile.data.transactions.push({
        id: Date.now() + 1,
        description: 'Погашение «' + creditName + '»',
        amount: amount,
        date: date,
        type: 'expense',
        category: 'Кредит',
        paymentMethod: 'card',
        isDebtPayment: true,
        toProfileId: creditProfileId
    });

    persistProfiles();
    updateAllUI();

    const modal = document.getElementById('payDebtModal');
    if (modal) modal.classList.remove('active');

    alert('Погашено ' + formatCurrency(amount) + ' с «' + sourceName + '». Текущий долг: ' + formatCurrency(debt));
}

// Навигация между секциями с glass-анимацией
function initNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.section');

    navButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetSection = this.getAttribute('data-section');
            const target = document.getElementById(targetSection + '-section');
            if (!target || target.classList.contains('active') || isSectionAnimating) return;

            const current = document.querySelector('.section.active');
            navButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            isSectionAnimating = true;

            if (current) {
                current.classList.add('section-exit');
                current.classList.remove('active');

                setTimeout(function() {
                    current.classList.remove('section-exit');
                    target.classList.add('active', 'section-enter');
                    requestAnimationFrame(function() {
                        requestAnimationFrame(function() {
                            target.classList.remove('section-enter');
                            target.classList.add('section-enter-active');
                            setTimeout(function() {
                                target.classList.remove('section-enter-active');
                                isSectionAnimating = false;
                                if (targetSection === 'statistics') {
                                    refreshActiveChart();
                                }
                            }, 380);
                        });
                    });
                }, 200);
            } else {
                target.classList.add('active');
                isSectionAnimating = false;
                if (targetSection === 'statistics') {
                    setTimeout(refreshActiveChart, 50);
                }
            }
        });
    });
}

// Инициализация фильтров транзакций
function initFilters() {
    const filterCategory = document.getElementById('filterCategory');
    const filterType = document.getElementById('filterType');
    const filterPayment = document.getElementById('filterPaymentMethod');

    if (filterCategory) {
        filterCategory.addEventListener('change', updateTransactionsList);
    }
    if (filterType) {
        filterType.addEventListener('change', updateTransactionsList);
    }
    if (filterPayment) {
        filterPayment.addEventListener('change', updateTransactionsList);
    }
}
// Загрузка файла
function initFileUpload() {
    const fileInput = document.getElementById('fileInput');
    
    if (!fileInput) return;

    fileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                
                processImportedTransactions(jsonData);
            } catch (error) {
                alert('Ошибка при чтении файла: ' + error.message);
                console.error(error);
            }
        };
        
        reader.onerror = function() {
            alert('Ошибка при чтении файла');
        };
        
        reader.readAsArrayBuffer(file);
    });
}

// Обработка импортированных транзакций
function processImportedTransactions(data) {
    if (!Array.isArray(data) || data.length === 0) {
        alert('Файл не содержит данных');
        return;
    }

    const imported = data.map((row, index) => {
        const description = String(row['Описание'] || row['Description'] || row['Назначение платежа'] || '');
        const amountStr = String(row['Сумма'] || row['Amount'] || row['Сумма операции'] || '0');
        const amount = parseFloat(amountStr.replace(/[^\d.-]/g, '')) || 0;
        const dateStr = String(row['Дата'] || row['Date'] || row['Дата операции'] || new Date().toISOString().split('T')[0]);

        const transactionDate = formatDateForInput(dateStr);
        const isIncome = amount >= 0;

        return {
            id: Date.now() + index,
            description: description.trim() || 'Без описания',
            amount: Math.abs(amount),
            date: transactionDate,
            type: isIncome ? 'income' : 'expense',
            category: categorizeTransaction(description, isIncome ? 'income' : 'expense'),
            paymentMethod: 'card'
        };
    });

    transactions = transactions.concat(imported);
    saveData();
    updateAllUI();
    alert('Импортировано транзакций: ' + imported.length);
}

// Форматирование даты
function formatDateForInput(dateString) {
    try {
        let date;
        
        if (typeof dateString === 'number') {
            date = new Date((dateString - 25569) * 86400 * 1000);
        } else {
            date = new Date(dateString);
        }
        
        if (isNaN(date.getTime())) {
            return new Date().toISOString().split('T')[0];
        }
        
        return date.toISOString().split('T')[0];
    } catch (err) {
        return new Date().toISOString().split('T')[0];
    }
}

// Автоматическая категоризация
function categorizeTransaction(description, type) {
    if (!description) return type === 'expense' ? 'Прочее' : 'Другие доходы';
    
    const lowerDesc = String(description).toLowerCase();
    
    if (categories[type]) {
        for (let category in categories[type]) {
            if (categories[type].hasOwnProperty(category)) {
                const keywords = categories[type][category];
                if (Array.isArray(keywords)) {
                    for (let i = 0; i < keywords.length; i++) {
                        if (lowerDesc.indexOf(keywords[i].toLowerCase()) !== -1) {
                            return category;
                        }
                    }
                }
            }
        }
    }
    
    return type === 'expense' ? 'Прочее' : 'Другие доходы';
}

// Форматирование валюты
function formatCurrency(amount) {
    return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

// Форматирование даты для отображения
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}
// Обновление всего UI
function updateAllUI() {
    updateStats();
    updateCategoriesOverview();
    updateTransactionsList();
    updateFilters();
    updateCategoriesList();
    updateCashBalance();
    updateCashHistory();
}

// Обновление статистики
function updateStats() {
    const cardTransactions = transactions.filter(t => t.paymentMethod === 'card');
    
    const totalIncome = cardTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
    
    const totalExpense = cardTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
    
    const balance = totalIncome - totalExpense;
    
    const incomeEl = document.getElementById('totalIncome');
    const expenseEl = document.getElementById('totalExpense');
    const balanceEl = document.getElementById('balance');
    const cashEl = document.getElementById('cashBalance');
    const debtCard = document.getElementById('debtCard');
    const debtEl = document.getElementById('totalDebt');

    if (incomeEl) incomeEl.textContent = formatCurrency(totalIncome);
    if (expenseEl) expenseEl.textContent = formatCurrency(totalExpense);
    if (balanceEl) balanceEl.textContent = formatCurrency(balance);
    if (cashEl) cashEl.textContent = formatCurrency(cashBalance);

    // Карточка «Долг» только для кредитного профиля
    if (isCurrentCreditProfile()) {
        recalculateDebtFromTransactions();
        if (debtCard) debtCard.hidden = false;
        if (debtEl) debtEl.textContent = formatCurrency(debt);
    } else {
        if (debtCard) debtCard.hidden = true;
        debt = 0;
    }
}

// Обновление обзора категорий
function updateCategoriesOverview() {
    const categoriesData = {};
    
    transactions
        .filter(t => t.type === 'expense')
        .forEach(t => {
            if (!categoriesData[t.category]) {
                categoriesData[t.category] = 0;
            }
            categoriesData[t.category] += t.amount;
        });
    
    const grid = document.getElementById('categoriesGrid');
    
    if (!grid) return;
    
    if (Object.keys(categoriesData).length === 0) {
        grid.innerHTML = '<div class="empty-state"><p>Нет данных о расходах</p></div>';
        return;
    }
    
    grid.innerHTML = '';
    
    const sorted = Object.entries(categoriesData).sort((a, b) => b[1] - a[1]);
    
    sorted.forEach(entry => {
        const category = entry[0];
        const amount = entry[1];
        
        const card = document.createElement('div');
        card.className = 'category-card';
        card.innerHTML = '<h4>' + category + '</h4><p class="category-amount">' + formatCurrency(amount) + '</p>';
        grid.appendChild(card);
    });
}

// Обновление списка транзакций с группировкой по датам
function updateTransactionsList() {
    const filterCategoryEl = document.getElementById('filterCategory');
    const filterTypeEl = document.getElementById('filterType');
    const filterPaymentEl = document.getElementById('filterPaymentMethod');
    
    const filterCategory = filterCategoryEl ? filterCategoryEl.value : 'all';
    const filterType = filterTypeEl ? filterTypeEl.value : 'all';
    const filterPaymentMethod = filterPaymentEl ? filterPaymentEl.value : 'all';
    
    const list = document.getElementById('transactionsList');
    
    if (!list) {
        return;
    }
    
    // Фильтруем транзакции
    let filtered = [];
    
    for (let i = 0; i < transactions.length; i++) {
        const t = transactions[i];
        
        let matchesFilter = true;
        
        if (filterCategory !== 'all' && t.category !== filterCategory) {
            matchesFilter = false;
        }
        if (filterType !== 'all' && t.type !== filterType) {
            matchesFilter = false;
        }
        if (filterPaymentMethod !== 'all' && t.paymentMethod !== filterPaymentMethod) {
            matchesFilter = false;
        }
        
        if (matchesFilter) {
            filtered.push(t);
        }
    }
    
    // Если нет данных
    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>Нет транзакций</p></div>';
        return;
    }
    
    // Сортировка по дате (новые сначала)
    filtered.sort((a, b) => {
        const dateA = new Date(b.date);
        const dateB = new Date(a.date);
        return dateA - dateB;
    });
    
    // Очищаем список
    list.innerHTML = '';
    
    // Группировка по датам
    const groupedByDate = {};
    
    for (let i = 0; i < filtered.length; i++) {
        const t = filtered[i];
        const dateKey = t.date;
        
        if (!groupedByDate[dateKey]) {
            groupedByDate[dateKey] = [];
        }
        groupedByDate[dateKey].push(t);
    }
    
    // Получаем все даты и сортируем их (новые сначала)
    const allDates = Object.keys(groupedByDate);
    allDates.sort((a, b) => {
        const dateA = new Date(b);
        const dateB = new Date(a);
        return dateA - dateB;
    });
    
    // Отображаем по датам
    for (let dateIdx = 0; dateIdx < allDates.length; dateIdx++) {
        const date = allDates[dateIdx];
        const dateGroup = groupedByDate[date];
        
        // Заголовок даты
        const dateHeader = document.createElement('div');
        dateHeader.style.cssText = 'padding: 16px 16px 8px; font-weight: 600; color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border); margin-top: 16px;';
        dateHeader.textContent = formatDateFull(date);
        list.appendChild(dateHeader);
        
        // Транзакции в этот день
        for (let j = 0; j < dateGroup.length; j++) {
            const t = dateGroup[j];
            const item = document.createElement('div');
            const isLargeExpense = t.type === 'expense' && t.amount > 5000;
            
            item.className = 'transaction-item';
            if (isLargeExpense) {
                item.classList.add('large-expense');
            }
            
            let badgeHTML = '';
            if (isLargeExpense) {
                badgeHTML = '<span class="large-expense-badge">⚠️ Крупная</span>';
            }
            
            const amountClass = t.type === 'income' ? 'income' : 'expense';
            const amountSign = t.type === 'income' ? '+' : '−';
            const paymentMethodText = t.paymentMethod === 'cash' ? '💵 Наличные' : '💳 Карта';
            const categoryText = t.category || 'Без категории';
            const descriptionText = t.description || 'Без описания';
            
            item.innerHTML = '<div class="transaction-info">' +
                '<div class="transaction-description">' + descriptionText + '</div>' +
                '<div class="transaction-meta">' +
                '<span class="transaction-category">' + categoryText + '</span>' +
                '<span class="payment-method-badge">' + paymentMethodText + '</span>' +
                '</div>' +
                '</div>' +
                '<div class="transaction-right">' +
                '<span class="transaction-amount ' + amountClass + '">' + 
                amountSign + formatCurrency(t.amount) + 
                badgeHTML +
                '</span>' +
                '<div class="transaction-actions">' +
                '<button onclick="editTransaction(' + t.id + ')" title="Редактировать">✏️</button>' +
                '<button onclick="deleteTransaction(' + t.id + ')" title="Удалить">🗑️</button>' +
                '</div>' +
                '</div>';
            
            list.appendChild(item);
        }
    }
}

// Форматирование даты полное (с днем недели)
function formatDateFull(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayStr = today.getFullYear() + '-' +
                     String(today.getMonth() + 1).padStart(2, '0') + '-' +
                     String(today.getDate()).padStart(2, '0');
    const yesterdayStr = yesterday.getFullYear() + '-' +
                        String(yesterday.getMonth() + 1).padStart(2, '0') + '-' +
                        String(yesterday.getDate()).padStart(2, '0');

    if (dateString === todayStr) {
        return 'Сегодня';
    } else if (dateString === yesterdayStr) {
        return 'Вчера';
    }

    return date.toLocaleDateString('ru-RU', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Обновление фильтров
function updateFilters() {
    const categoryFilter = document.getElementById('filterCategory');
    
    if (!categoryFilter) return;
    
    const uniqueCategories = [];
    const seen = {};
    
    for (let i = 0; i < transactions.length; i++) {
        const cat = transactions[i].category;
        if (!seen[cat]) {
            uniqueCategories.push(cat);
            seen[cat] = true;
        }
    }
    
    const currentValue = categoryFilter.value;
    
    categoryFilter.innerHTML = '<option value="all">Все категории</option>';
    
    for (let i = 0; i < uniqueCategories.length; i++) {
        const cat = uniqueCategories[i];
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categoryFilter.appendChild(option);
    }
    
    categoryFilter.value = currentValue;
}

// Обновление баланса наличных
function updateCashBalance() {
    const displayEl = document.getElementById('cashBalanceDisplay');
    if (displayEl) {
        displayEl.textContent = formatCurrency(cashBalance);
    }
}

// Обновление истории наличных
function updateCashHistory() {
    const history = document.getElementById('cashHistory');
    if (!history) return;
    
    if (cashHistory.length === 0) {
        history.innerHTML = '<div class="empty-state"><p>Нет операций с наличными</p></div>';
        return;
    }
    
    history.innerHTML = '';
    
    const sorted = cashHistory.slice().reverse();
    
    sorted.forEach(item => {
        const element = document.createElement('div');
        element.className = 'cash-history-item';
        
        const amountClass = item.type === 'add' ? 'positive' : 'negative';
        const amountSign = item.type === 'add' ? '+' : '−';
        const typeText = item.type === 'add' ? 'Пополнение' : 'Снятие';
        
        element.innerHTML = '<div class="cash-history-info">' +
            '<div class="cash-history-type">' + typeText + '</div>' +
            '<div class="cash-history-date">' + formatDate(item.date) + '</div>' +
            (item.description ? '<div class="cash-history-date">' + item.description + '</div>' : '') +
            '</div>' +
            '<div class="cash-history-amount ' + amountClass + '">' +
            amountSign + formatCurrency(item.amount) +
            '</div>';
        
        history.appendChild(element);
    });
}
// Управление категориями
function initCategoryTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const allTabs = document.querySelectorAll('.tab-btn');
            allTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            updateCategoriesList();
        });
    });
}

function updateCategoriesList() {
    const activeTab = document.querySelector('.tab-btn.active');
    if (!activeTab) return;
    
    const activeType = activeTab.getAttribute('data-type');
    const list = document.getElementById('categoriesList');
    
    if (!list) return;
    
    list.innerHTML = '';
    
    if (categories[activeType]) {
        for (let name in categories[activeType]) {
            if (categories[activeType].hasOwnProperty(name)) {
                const keywords = categories[activeType][name];
                const keywordsStr = Array.isArray(keywords) ? keywords.join(', ') : '';
                
                const item = document.createElement('div');
                item.className = 'category-item';
                item.innerHTML = '<div class="category-item-info">' +
                    '<div class="category-item-name">' + name + '</div>' +
                    '<div class="category-item-keywords">' + (keywordsStr || 'Нет ключевых слов') + '</div>' +
                    '</div>' +
                    '<div class="category-item-actions">' +
                    '<button class="btn-delete" onclick="deleteCategory(\'' + activeType + '\', \'' + name.replace(/'/g, "\\'") + '\')">Удалить</button>' +
                    '</div>';
                list.appendChild(item);
            }
        }
    }
}

function deleteCategory(type, name) {
    if (!confirm('Удалить категорию "' + name + '"?')) return;
    
    if (categories[type] && categories[type][name]) {
        delete categories[type][name];
        saveData();
        updateCategoriesList();
    }
}

function saveCategory() {
    const nameEl = document.getElementById('categoryName');
    const typeEl = document.getElementById('categoryType');
    const keywordsEl = document.getElementById('categoryKeywords');

    if (!nameEl || !typeEl || !keywordsEl) return;

    const name = nameEl.value.trim();
    const type = typeEl.value;
    const keywordsInput = keywordsEl.value;
    const keywords = keywordsInput.split(',').map(k => k.trim()).filter(k => k);

    if (!name) {
        alert('Введите название категории');
        return;
    }

    if (categories[type] && categories[type][name]) {
        alert('Категория с таким названием уже существует');
        return;
    }

    if (!categories[type]) {
        categories[type] = {};
    }

    categories[type][name] = keywords;
    saveData();
    updateCategoriesList();
    
    const modal = document.getElementById('categoryModal');
    if (modal) modal.classList.remove('active');
}
// Модальные окна
function initModals() {
    // Модальное окно транзакции
    const transactionModal = document.getElementById('transactionModal');
    const addTransactionBtn = document.getElementById('addTransactionBtn');
    const closeTransactionModal = document.getElementById('closeTransactionModal');
    const cancelTransaction = document.getElementById('cancelTransaction');
    const transactionForm = document.getElementById('transactionForm');
    const transactionTypeEl = document.getElementById('transactionType');

    if (addTransactionBtn) {
        addTransactionBtn.addEventListener('click', function() {
            editingTransactionId = null;
            const titleEl = document.getElementById('transactionModalTitle');
            if (titleEl) titleEl.textContent = 'Добавить транзакцию';
            if (transactionForm) transactionForm.reset();
            const dateEl = document.getElementById('transactionDate');
            if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
            updateTransactionCategoryOptions();
            if (transactionModal) transactionModal.classList.add('active');
        });
    }

    if (closeTransactionModal) {
        closeTransactionModal.addEventListener('click', function() {
            if (transactionModal) transactionModal.classList.remove('active');
        });
    }

    if (cancelTransaction) {
        cancelTransaction.addEventListener('click', function() {
            if (transactionModal) transactionModal.classList.remove('active');
        });
    }

    if (transactionForm) {
        transactionForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveTransaction();
        });
    }

    if (transactionTypeEl) {
        transactionTypeEl.addEventListener('change', updateTransactionCategoryOptions);
    }

// Модальное окно редактирования баланса счета
    const editBalanceBtn = document.getElementById('editBalanceBtn');
    const balanceModal = document.createElement('div');
    balanceModal.className = 'modal';
    balanceModal.id = 'balanceModal';
    balanceModal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Изменить баланс счета</h3>
                <button class="modal-close" onclick="document.getElementById('balanceModal').classList.remove('active')">&times;</button>
            </div>
            <form id="balanceForm">
                <div class="form-group">
                    <label>Введите новый баланс</label>
                    <input type="number" id="balanceInput" step="0.01" required>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-secondary" onclick="document.getElementById('balanceModal').classList.remove('active')">Отмена</button>
                    <button type="submit" class="btn-primary">Сохранить</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(balanceModal);

    if (editBalanceBtn) {
        editBalanceBtn.addEventListener('click', function() {
            const currentBalance = transactions
                .filter(t => t.paymentMethod === 'card')
                .reduce((sum, t) => t.type === 'income' ? sum + t.amount : sum - t.amount, 0);
            
            const balanceInput = document.getElementById('balanceInput');
            if (balanceInput) balanceInput.value = currentBalance;
            balanceModal.classList.add('active');
        });
    }

    const balanceForm = document.getElementById('balanceForm');
    if (balanceForm) {
        balanceForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveBalanceChange();
        });
    }

    // Модальное окно категории
    const categoryModal = document.getElementById('categoryModal');
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    const closeCategoryModal = document.getElementById('closeCategoryModal');
    const cancelCategory = document.getElementById('cancelCategory');
    const categoryForm = document.getElementById('categoryForm');

    if (addCategoryBtn) {
        addCategoryBtn.addEventListener('click', function() {
            if (categoryForm) categoryForm.reset();
            const activeTab = document.querySelector('.tab-btn.active');
            const activeType = activeTab ? activeTab.getAttribute('data-type') : 'expense';
            const categoryTypeEl = document.getElementById('categoryType');
            if (categoryTypeEl) categoryTypeEl.value = activeType;
            if (categoryModal) categoryModal.classList.add('active');
        });
    }

    if (closeCategoryModal) {
        closeCategoryModal.addEventListener('click', function() {
            if (categoryModal) categoryModal.classList.remove('active');
        });
    }

    if (cancelCategory) {
        cancelCategory.addEventListener('click', function() {
            if (categoryModal) categoryModal.classList.remove('active');
        });
    }

    if (categoryForm) {
        categoryForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveCategory();
        });
    }

    // Закрытие по клику вне модального окна
    window.addEventListener('click', function(e) {
        if (e.target.classList && e.target.classList.contains('modal')) {
            e.target.classList.remove('active');
        }
    });
}
// Инициализация модального окна наличных
function initCashModal() {
    const cashModal = document.getElementById('cashModal');
    const addCashBtn = document.getElementById('addCashBtn');
    const withdrawCashBtn = document.getElementById('withdrawCashBtn');
    const closeCashModal = document.getElementById('closeCashModal');
    const cancelCash = document.getElementById('cancelCash');
    const cashForm = document.getElementById('cashForm');

    let cashOperationType = 'add';

    if (addCashBtn) {
        addCashBtn.addEventListener('click', function() {
            cashOperationType = 'add';
            const titleEl = document.getElementById('cashModalTitle');
            if (titleEl) titleEl.textContent = 'Пополнить наличные';
            if (cashForm) cashForm.reset();
            if (cashModal) cashModal.classList.add('active');
        });
    }

    if (withdrawCashBtn) {
        withdrawCashBtn.addEventListener('click', function() {
            cashOperationType = 'withdraw';
            const titleEl = document.getElementById('cashModalTitle');
            if (titleEl) titleEl.textContent = 'Снять наличные';
            if (cashForm) cashForm.reset();
            if (cashModal) cashModal.classList.add('active');
        });
    }

    if (closeCashModal) {
        closeCashModal.addEventListener('click', function() {
            if (cashModal) cashModal.classList.remove('active');
        });
    }

    if (cancelCash) {
        cancelCash.addEventListener('click', function() {
            if (cashModal) cashModal.classList.remove('active');
        });
    }

    if (cashForm) {
        cashForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveCashOperation(cashOperationType);
        });
    }
}

// Сохранение операции с наличными
function saveCashOperation(operationType) {
    const amountEl = document.getElementById('cashAmount');
    const descEl = document.getElementById('cashDescription');

    if (!amountEl) return;

    const amount = parseFloat(amountEl.value);
    const description = descEl ? descEl.value.trim() : '';

    if (!amount || amount <= 0) {
        alert('Введите корректную сумму');
        return;
    }

    if (operationType === 'withdraw' && amount > cashBalance) {
        alert('Недостаточно наличных. Текущий баланс: ' + formatCurrency(cashBalance));
        return;
    }

    if (operationType === 'add') {
        cashBalance += amount;
    } else {
        cashBalance -= amount;
    }

    cashHistory.push({
        type: operationType,
        amount: amount,
        date: new Date().toISOString().split('T')[0],
        description: description
    });

    saveData();
    updateAllUI();

    const modal = document.getElementById('cashModal');
    if (modal) modal.classList.remove('active');
}
// Обновление опций категорий в форме
function updateTransactionCategoryOptions() {
    const typeEl = document.getElementById('transactionType');
    const categorySelect = document.getElementById('transactionCategory');
    
    if (!typeEl || !categorySelect) return;
    
    const type = typeEl.value;
    
    categorySelect.innerHTML = '';
    
    if (categories[type]) {
        for (let cat in categories[type]) {
            if (categories[type].hasOwnProperty(cat)) {
                const option = document.createElement('option');
                option.value = cat;
                option.textContent = cat;
                categorySelect.appendChild(option);
            }
        }
    }
}
// Сохранение транзакции
function saveTransaction() {
    const descEl = document.getElementById('transactionDescription');
    const amountEl = document.getElementById('transactionAmount');
    const dateEl = document.getElementById('transactionDate');
    const typeEl = document.getElementById('transactionType');
    const categoryEl = document.getElementById('transactionCategory');
    const methodEl = document.getElementById('transactionPaymentMethod');

    if (!descEl || !amountEl || !dateEl || !typeEl || !categoryEl || !methodEl) {
        alert('Ошибка при загрузке формы');
        return;
    }

    const description = descEl.value.trim();
    const amount = parseFloat(amountEl.value);
    const date = dateEl.value;
    const type = typeEl.value;
    const category = categoryEl.value;
    const paymentMethod = methodEl.value;

    if (!description || !amount || !date) {
        alert('Пожалуйста, заполните все поля');
        return;
    }

    if (amount <= 0) {
        alert('Сумма должна быть больше нуля');
        return;
    }

    if (editingTransactionId) {
        // Редактирование существующей транзакции
        editExistingTransaction(editingTransactionId, {
            description: description,
            amount: amount,
            date: date,
            type: type,
            category: category,
            paymentMethod: paymentMethod
        });
    } else {
        // Создание новой транзакции
        createNewTransaction({
            description: description,
            amount: amount,
            date: date,
            type: type,
            category: category,
            paymentMethod: paymentMethod
        });
    }

    saveData();
    updateAllUI();
    const modal = document.getElementById('transactionModal');
    if (modal) modal.classList.remove('active');
}

// Редактирование существующей транзакции
function editExistingTransaction(transactionId, newData) {
    for (let i = 0; i < transactions.length; i++) {
        if (transactions[i].id === transactionId) {
            const oldTransaction = transactions[i];
            
            // Корректировка баланса наличных при изменении способа оплаты
            if (oldTransaction.paymentMethod === 'cash' && newData.paymentMethod === 'card') {
                if (oldTransaction.type === 'expense') {
                    cashBalance += oldTransaction.amount;
                } else {
                    cashBalance -= oldTransaction.amount;
                }
            } else if (oldTransaction.paymentMethod === 'card' && newData.paymentMethod === 'cash') {
                if (newData.type === 'expense') {
                    cashBalance -= newData.amount;
                } else {
                    cashBalance += newData.amount;
                }
            }

            transactions[i] = {
                id: transactionId,
                description: newData.description,
                amount: newData.amount,
                date: newData.date,
                type: newData.type,
                category: newData.category,
                paymentMethod: newData.paymentMethod
            };
            break;
        }
    }
}

// Создание новой транзакции
function createNewTransaction(data) {
    transactions.push({
        id: Date.now(),
        description: data.description,
        amount: data.amount,
        date: data.date,
        type: data.type,
        category: data.category,
        paymentMethod: data.paymentMethod
    });

    // Обновление баланса наличных для новой транзакции
    if (data.paymentMethod === 'cash') {
        if (data.type === 'expense') {
            cashBalance -= data.amount;
        } else {
            cashBalance += data.amount;
        }
    }
}
// Редактирование транзакции
function editTransaction(id) {
    const transaction = transactions.find(t => t.id === id);
    if (!transaction) {
        alert('Транзакция не найдена');
        return;
    }

    editingTransactionId = id;
    
    const titleEl = document.getElementById('transactionModalTitle');
    if (titleEl) titleEl.textContent = 'Редактировать транзакцию';
    
    const descEl = document.getElementById('transactionDescription');
    const amountEl = document.getElementById('transactionAmount');
    const dateEl = document.getElementById('transactionDate');
    const typeEl = document.getElementById('transactionType');
    const categoryEl = document.getElementById('transactionCategory');
    const methodEl = document.getElementById('transactionPaymentMethod');

    if (descEl) descEl.value = transaction.description;
    if (amountEl) amountEl.value = transaction.amount;
    if (dateEl) dateEl.value = transaction.date;
    if (typeEl) typeEl.value = transaction.type;
    
    updateTransactionCategoryOptions();
    
    if (categoryEl) categoryEl.value = transaction.category;
    if (methodEl) methodEl.value = transaction.paymentMethod;
    
    const modal = document.getElementById('transactionModal');
    if (modal) modal.classList.add('active');
}

// Удаление транзакции
function deleteTransaction(id) {
    if (!confirm('Удалить эту транзакцию?')) return;

    for (let i = 0; i < transactions.length; i++) {
        if (transactions[i].id === id) {
            const transaction = transactions[i];
            
            // Возврат средств в баланс наличных
            if (transaction.paymentMethod === 'cash') {
                if (transaction.type === 'expense') {
                    cashBalance += transaction.amount;
                } else {
                    cashBalance -= transaction.amount;
                }
            }

            transactions.splice(i, 1);
            break;
        }
    }

    saveData();
    updateAllUI();
}
// Сохранение изменения баланса счета
function saveBalanceChange() {
    const balanceInput = document.getElementById('balanceInput');
    if (!balanceInput) return;

    const newBalance = parseFloat(balanceInput.value);
    
    if (isNaN(newBalance)) {
        alert('Введите корректное значение');
        return;
    }

    const currentBalance = transactions
        .filter(t => t.paymentMethod === 'card')
        .reduce((sum, t) => t.type === 'income' ? sum + t.amount : sum - t.amount, 0);
    
    const difference = newBalance - currentBalance;

    // Добавляем корректирующую транзакцию
    if (difference !== 0) {
        const correctionType = difference > 0 ? 'income' : 'expense';
        transactions.push({
            id: Date.now(),
            description: 'Корректировка баланса',
            amount: Math.abs(difference),
            date: new Date().toISOString().split('T')[0],
            type: correctionType,
            category: 'Корректировка',
            paymentMethod: 'card'
        });

        // Добавим категорию Корректировка если ее нет
        if (!categories.expense['Корректировка']) {
            categories.expense['Корректировка'] = [];
        }
    }

    saveData();
    updateAllUI();
    document.getElementById('balanceModal').classList.remove('active');
    alert('Баланс обновлен!');
}

// Гарантируем наличие canvas в контейнере общего графика
function ensureChartCanvas() {
    const container = document.getElementById('overviewChartContainer') ||
        document.querySelector('#chartPanelOverview .chart-container');
    if (!container) return null;

    let canvasEl = document.getElementById('balanceChart');
    if (!canvasEl) {
        container.innerHTML = '<canvas id="balanceChart"></canvas>';
        canvasEl = document.getElementById('balanceChart');
    }
    return canvasEl;
}

function ensureDetailedChartCanvas() {
    const container = document.getElementById('detailedChartContainer') ||
        document.querySelector('#chartPanelDetailed .chart-container');
    if (!container) return null;

    let canvasEl = document.getElementById('detailedChart');
    if (!canvasEl) {
        container.innerHTML = '<canvas id="detailedChart"></canvas>';
        canvasEl = document.getElementById('detailedChart');
    }
    return canvasEl;
}

// Палитра для категорий (детальный график)
const CHART_CATEGORY_COLORS = [
    '#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2',
    '#64d2ff', '#ffd60a', '#ff375f', '#ac8e68', '#5e5ce6',
    '#32ade6', '#ff6961'
];

function initChartTabs() {
    const tabs = document.querySelectorAll('.chart-tab-btn');
    tabs.forEach(btn => {
        btn.addEventListener('click', function() {
            const view = this.getAttribute('data-chart');
            if (!view || view === currentChartView) return;
            currentChartView = view;

            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            const overview = document.getElementById('chartPanelOverview');
            const detailed = document.getElementById('chartPanelDetailed');
            if (overview) overview.classList.toggle('active', view === 'overview');
            if (detailed) detailed.classList.toggle('active', view === 'detailed');

            if (view === 'overview') {
                setTimeout(updateBalanceChart, 40);
            } else {
                renderChartCategoryChips();
                setTimeout(updateDetailedChart, 40);
            }
        });
    });

    const typeFilter = document.getElementById('chartFilterType');
    if (typeFilter) {
        typeFilter.addEventListener('change', function() {
            selectedChartCategories = [];
            renderChartCategoryChips();
            updateDetailedChart();
        });
    }

    const selectAll = document.getElementById('chartSelectAllCats');
    if (selectAll) {
        selectAll.addEventListener('click', function() {
            const available = getCategoriesForDetailedChart();
            selectedChartCategories = available.slice();
            renderChartCategoryChips();
            updateDetailedChart();
        });
    }

    const clearAll = document.getElementById('chartClearCats');
    if (clearAll) {
        clearAll.addEventListener('click', function() {
            selectedChartCategories = [];
            renderChartCategoryChips();
            updateDetailedChart();
        });
    }
}

function getCategoriesForDetailedChart() {
    const typeEl = document.getElementById('chartFilterType');
    const typeFilter = typeEl ? typeEl.value : 'expense';
    const set = {};
    transactions.forEach(t => {
        if (!t.category) return;
        if (typeFilter === 'expense' && t.type !== 'expense') return;
        if (typeFilter === 'income' && t.type !== 'income') return;
        set[t.category] = true;
    });
    return Object.keys(set).sort(function(a, b) {
        return a.localeCompare(b, 'ru');
    });
}

function renderChartCategoryChips() {
    const container = document.getElementById('chartCategoryChips');
    if (!container) return;

    const available = getCategoriesForDetailedChart();
    if (selectedChartCategories.length === 0 && available.length > 0) {
        // По умолчанию выбираем до 5 категорий с наибольшими суммами
        const typeEl = document.getElementById('chartFilterType');
        const typeFilter = typeEl ? typeEl.value : 'expense';
        const totals = {};
        transactions.forEach(t => {
            if (!t.category) return;
            if (typeFilter === 'expense' && t.type !== 'expense') return;
            if (typeFilter === 'income' && t.type !== 'income') return;
            totals[t.category] = (totals[t.category] || 0) + t.amount;
        });
        selectedChartCategories = available
            .slice()
            .sort(function(a, b) { return (totals[b] || 0) - (totals[a] || 0); })
            .slice(0, 5);
    }

    // Убираем категории, которых больше нет
    selectedChartCategories = selectedChartCategories.filter(function(c) {
        return available.indexOf(c) !== -1;
    });

    if (available.length === 0) {
        container.innerHTML = '<span class="chart-chips-empty">Нет категорий для отображения</span>';
        return;
    }

    container.innerHTML = '';
    available.forEach(function(cat, index) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chart-cat-chip' + (selectedChartCategories.indexOf(cat) !== -1 ? ' active' : '');
        const color = CHART_CATEGORY_COLORS[index % CHART_CATEGORY_COLORS.length];
        chip.style.setProperty('--chip-color', color);
        chip.textContent = cat;
        chip.addEventListener('click', function() {
            const idx = selectedChartCategories.indexOf(cat);
            if (idx === -1) {
                selectedChartCategories.push(cat);
            } else {
                selectedChartCategories.splice(idx, 1);
            }
            renderChartCategoryChips();
            updateDetailedChart();
        });
        container.appendChild(chip);
    });
}

function updateDetailedChart() {
    const canvasEl = ensureDetailedChartCanvas();
    if (!canvasEl) return;

    const container = canvasEl.parentElement;
    const typeEl = document.getElementById('chartFilterType');
    const typeFilter = typeEl ? typeEl.value : 'expense';

    let filtered = transactions.filter(function(t) {
        if (typeFilter === 'expense' && t.type !== 'expense') return false;
        if (typeFilter === 'income' && t.type !== 'income') return false;
        if (selectedChartCategories.length > 0 && selectedChartCategories.indexOf(t.category) === -1) return false;
        return true;
    });

    if (filtered.length === 0 || selectedChartCategories.length === 0) {
        if (detailedChart) {
            detailedChart.destroy();
            detailedChart = null;
        }
        const msg = selectedChartCategories.length === 0
            ? 'Выберите хотя бы одну категорию'
            : 'Нет данных по выбранным категориям';
        container.innerHTML = '<p class="chart-empty-message" style="text-align: center; color: #98989d; padding: 40px;">' + msg + '</p>';
        return;
    }

    if (!document.getElementById('detailedChart')) {
        container.innerHTML = '<canvas id="detailedChart"></canvas>';
    }
    const activeCanvas = document.getElementById('detailedChart');
    if (!activeCanvas) return;

    // Все даты из отфильтрованных транзакций
    const dateSet = {};
    filtered.forEach(function(t) { if (t.date) dateSet[t.date] = true; });
    const allDates = Object.keys(dateSet).sort();

    // Суммы по категории и дате
    const byCatDate = {};
    selectedChartCategories.forEach(function(cat) { byCatDate[cat] = {}; });
    filtered.forEach(function(t) {
        if (!byCatDate[t.category]) byCatDate[t.category] = {};
        byCatDate[t.category][t.date] = (byCatDate[t.category][t.date] || 0) + t.amount;
    });

    const labels = allDates.map(formatDateShort);
    const available = getCategoriesForDetailedChart();
    const datasets = selectedChartCategories.map(function(cat) {
        const colorIndex = available.indexOf(cat);
        const color = CHART_CATEGORY_COLORS[(colorIndex >= 0 ? colorIndex : 0) % CHART_CATEGORY_COLORS.length];
        return {
            label: cat,
            data: allDates.map(function(d) { return byCatDate[cat][d] || 0; }),
            borderColor: color,
            backgroundColor: color + '33',
            fill: false,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2,
            pointBackgroundColor: color,
            pointBorderColor: '#1c1c1e',
            pointBorderWidth: 1
        };
    });

    if (detailedChart) {
        detailedChart.destroy();
        detailedChart = null;
    }

    const ctx = activeCanvas.getContext('2d');
    if (!ctx) return;

    try {
        detailedChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#f5f5f7',
                            font: { family: 'system-ui, -apple-system, sans-serif', size: 12 },
                            padding: 12,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(28, 28, 30, 0.95)',
                        titleColor: '#f5f5f7',
                        bodyColor: '#f5f5f7',
                        padding: 12,
                        cornerRadius: 8,
                        borderColor: '#38383a',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Сумма',
                            color: '#f5f5f7'
                        },
                        ticks: {
                            callback: function(value) { return formatCurrency(value); },
                            color: '#98989d',
                            font: { size: 11 }
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.06)',
                            drawBorder: false
                        }
                    },
                    x: {
                        ticks: {
                            color: '#98989d',
                            font: { size: 11 }
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.06)',
                            drawBorder: false
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Ошибка при создании детального графика:', error);
    }
}

function refreshActiveChart() {
    if (currentChartView === 'detailed') {
        renderChartCategoryChips();
        updateDetailedChart();
    } else {
        updateBalanceChart();
    }
}

// Обновление графика
function updateBalanceChart() {
    const canvasEl = ensureChartCanvas();
    if (!canvasEl) {
        console.warn('Canvas элемент не найден');
        return;
    }

    const container = canvasEl.parentElement;

    const cardTransactions = transactions.filter(t => t.paymentMethod === 'card');
    const cashTransactions = transactions.filter(t => t.paymentMethod === 'cash');
    const hasCashData = cashTransactions.length > 0 || cashHistory.length > 0;

    // Нет ни карточных, ни наличных данных
    if (cardTransactions.length === 0 && !hasCashData) {
        if (balanceChart) {
            balanceChart.destroy();
            balanceChart = null;
        }
        container.innerHTML = '<p class="chart-empty-message" style="text-align: center; color: #98989d; padding: 40px;">Нет данных для отображения</p>';
        return;
    }

    // Восстанавливаем canvas, если ранее показывали сообщение
    if (!document.getElementById('balanceChart')) {
        container.innerHTML = '<canvas id="balanceChart"></canvas>';
    }
    const activeCanvas = document.getElementById('balanceChart');
    if (!activeCanvas) return;

    // Собираем все даты (карта + наличные из транзакций + история раздела «Наличные»)
    const dateSet = {};

    cardTransactions.forEach(t => { dateSet[t.date] = true; });
    cashTransactions.forEach(t => { dateSet[t.date] = true; });
    cashHistory.forEach(h => { if (h.date) dateSet[h.date] = true; });

    const allDates = Object.keys(dateSet).sort();

    // Карта: кумулятивный баланс по дням
    const cardByDate = {};
    cardTransactions.forEach(t => {
        if (!t.date) return;
        if (!cardByDate[t.date]) {
            cardByDate[t.date] = { income: 0, expense: 0 };
        }
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') {
            cardByDate[t.date].income += amt;
        } else {
            cardByDate[t.date].expense += amt;
        }
    });

    // Столбцы: доходы/расходы за день по ВСЕМ транзакциям (карта + наличные)
    const flowByDate = {};
    transactions.forEach(t => {
        if (!t.date) return;
        if (!flowByDate[t.date]) {
            flowByDate[t.date] = { income: 0, expense: 0 };
        }
        const amt = Number(t.amount) || 0;
        if (amt <= 0) return;
        if (t.type === 'income') {
            flowByDate[t.date].income += amt;
        } else if (t.type === 'expense') {
            flowByDate[t.date].expense += amt;
        }
    });

    // Наличные: изменение за день
    // Источники:
    // 1) Транзакции со способом оплаты «Наличные»
    // 2) Операции из раздела «Наличные» (пополнение / снятие)
    const cashDeltaByDate = {};

    cashTransactions.forEach(t => {
        if (!t.date) return;
        if (!cashDeltaByDate[t.date]) cashDeltaByDate[t.date] = 0;
        // Доход наличными → +, расход наличными → −
        cashDeltaByDate[t.date] += (t.type === 'income' ? t.amount : -t.amount);
    });

    cashHistory.forEach(h => {
        if (!h.date) return;
        if (!cashDeltaByDate[h.date]) cashDeltaByDate[h.date] = 0;
        // add — пополнение, withdraw — снятие
        cashDeltaByDate[h.date] += (h.type === 'add' ? h.amount : -h.amount);
    });

    // Чтобы конечная точка линии совпадала с текущим балансом из раздела «Наличные»,
    // считаем стартовый баланс: текущий − сумма всех изменений
    let totalCashDelta = 0;
    Object.keys(cashDeltaByDate).forEach(d => {
        totalCashDelta += cashDeltaByDate[d];
    });
    const startingCash = cashBalance - totalCashDelta;

    // Кумулятивные ряды
    let cumulativeCard = 0;
    let cumulativeCash = startingCash;
    const cardBalances = [];
    const cashBalances = [];
    const labels = [];
    const incomes = [];
    const expenses = [];

    allDates.forEach(date => {
        const dayCard = cardByDate[date] || { income: 0, expense: 0 };
        const dayFlow = flowByDate[date] || { income: 0, expense: 0 };
        cumulativeCard += dayCard.income - dayCard.expense;
        cumulativeCash += cashDeltaByDate[date] || 0;

        cardBalances.push(cumulativeCard);
        cashBalances.push(cumulativeCash);
        // null вместо 0 — чтобы не рисовать «пустые» столбцы на нуле
        incomes.push(dayFlow.income > 0 ? dayFlow.income : null);
        // Расходы вниз от нуля
        expenses.push(dayFlow.expense > 0 ? -dayFlow.expense : null);
        labels.push(formatDateShort(date));
    });

    // Если нет дат по наличным, но баланс наличных > 0 — плоская линия на всём графике
    if (allDates.length > 0 && Object.keys(cashDeltaByDate).length === 0 && cashBalance !== 0) {
        for (let i = 0; i < cashBalances.length; i++) {
            cashBalances[i] = cashBalance;
        }
    }

    // Удаляем старый график
    if (balanceChart) {
        balanceChart.destroy();
        balanceChart = null;
    }

    const ctx = activeCanvas.getContext('2d');
    if (!ctx) {
        console.error('Не удалось получить контекст canvas');
        return;
    }

    // Симметричная шкала: 0 ₽ по центру, доходы вверх, расходы вниз
    let maxFlow = 0;
    incomes.forEach(function(v) { if (v != null && v > maxFlow) maxFlow = v; });
    expenses.forEach(function(v) { if (v != null && Math.abs(v) > maxFlow) maxFlow = Math.abs(v); });
    if (maxFlow === 0) maxFlow = 1000;
    maxFlow = maxFlow * 1.2;

    try {
        balanceChart = new Chart(ctx, {
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Доходы',
                        data: incomes,
                        backgroundColor: 'rgba(48, 209, 88, 0.65)',
                        hoverBackgroundColor: 'rgba(48, 209, 88, 0.85)',
                        borderWidth: 0,
                        borderRadius: { topLeft: 5, topRight: 5, bottomLeft: 0, bottomRight: 0 },
                        borderSkipped: 'bottom',
                        yAxisID: 'y1',
                        order: 3,
                        categoryPercentage: 0.65,
                        barPercentage: 0.9,
                        stack: 'flow'
                    },
                    {
                        type: 'bar',
                        label: 'Расходы',
                        data: expenses,
                        backgroundColor: 'rgba(255, 69, 58, 0.65)',
                        hoverBackgroundColor: 'rgba(255, 69, 58, 0.85)',
                        borderWidth: 0,
                        borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 5, bottomRight: 5 },
                        borderSkipped: 'top',
                        yAxisID: 'y1',
                        order: 3,
                        categoryPercentage: 0.65,
                        barPercentage: 0.9,
                        stack: 'flow'
                    },
                    {
                        type: 'line',
                        label: 'Баланс карты',
                        data: cardBalances,
                        borderColor: '#f5f5f7',
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.35,
                        pointRadius: 3,
                        pointBackgroundColor: '#f5f5f7',
                        pointBorderColor: '#1c1c1e',
                        pointBorderWidth: 2,
                        pointHoverRadius: 5,
                        borderWidth: 2.5,
                        yAxisID: 'y',
                        order: 1,
                        spanGaps: true
                    },
                    {
                        type: 'line',
                        label: 'Наличные',
                        data: cashBalances,
                        borderColor: '#0a84ff',
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.35,
                        pointRadius: 3,
                        pointBackgroundColor: '#0a84ff',
                        pointBorderColor: '#1c1c1e',
                        pointBorderWidth: 2,
                        pointHoverRadius: 5,
                        borderWidth: 2,
                        borderDash: [6, 3],
                        yAxisID: 'y',
                        order: 2,
                        spanGaps: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#f5f5f7',
                            font: {
                                family: "system-ui, -apple-system, sans-serif",
                                size: 12
                            },
                            padding: 14,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(28, 28, 30, 0.95)',
                        titleColor: '#f5f5f7',
                        bodyColor: '#f5f5f7',
                        padding: 12,
                        cornerRadius: 8,
                        borderColor: '#38383a',
                        borderWidth: 1,
                        filter: function(tooltipItem) {
                            return tooltipItem.parsed.y !== null && tooltipItem.parsed.y !== 0;
                        },
                        callbacks: {
                            label: function(context) {
                                const value = context.parsed.y;
                                if (value === null || value === undefined) return null;
                                if (context.dataset.label === 'Расходы') {
                                    return context.dataset.label + ': ' + formatCurrency(Math.abs(value));
                                }
                                return context.dataset.label + ': ' + formatCurrency(value);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Баланс',
                            color: '#98989d',
                            font: { size: 11 }
                        },
                        ticks: {
                            callback: function(value) {
                                return formatCurrency(value);
                            },
                            color: '#98989d',
                            font: { size: 11 }
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        stacked: true,
                        min: -maxFlow,
                        max: maxFlow,
                        title: {
                            display: true,
                            text: 'Доходы ↑  /  ↓ Расходы',
                            color: '#98989d',
                            font: { size: 11 }
                        },
                        ticks: {
                            callback: function(value) {
                                if (value === 0) return '0 ₽';
                                return formatCurrency(Math.abs(value));
                            },
                            color: '#98989d',
                            font: { size: 11 }
                        },
                        grid: {
                            color: function(context) {
                                return context.tick && context.tick.value === 0
                                    ? 'rgba(255, 255, 255, 0.5)'
                                    : 'rgba(255, 255, 255, 0.05)';
                            },
                            lineWidth: function(context) {
                                return context.tick && context.tick.value === 0 ? 2 : 1;
                            },
                            drawBorder: false
                        }
                    },
                    x: {
                        stacked: true,
                        offset: true,
                        ticks: {
                            color: '#98989d',
                            font: { size: 11 }
                        },
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Ошибка при создании графика:', error);
    }
}

// Форматирование даты (короткое)
function formatDateShort(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
        month: 'short',
        day: 'numeric'
    });
}

// Обновляем график при каждом обновлении всех данных
const originalUpdateAllUI = updateAllUI;
updateAllUI = function() {
    originalUpdateAllUI();
    setTimeout(refreshActiveChart, 100);
};

// Обновляем график при каждом обновлении UI
document.addEventListener('DOMContentLoaded', function() {
    initChartTabs();
    setTimeout(function() {
        refreshActiveChart();
    }, 500);
});

// Инициализация модального окна наличных после DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
    initCashModal();
});
// Автосохранение при изменениях
window.addEventListener('beforeunload', function() {
    saveData();
});

// Сохранение при потере фокуса окна
window.addEventListener('blur', function() {
    saveData();
});

// Периодическое сохранение каждые 30 секунд
setInterval(function() {
    if (transactions.length > 0 || cashHistory.length > 0) {
        saveData();
    }
}, 30000);