/**
 * Manifest Commerce Dashboard - Web Framework Demonstration
 * (examples/web/commerce_dashboard_app.ts)
 *
 * Implements the full interactive Manifest Commerce Dashboard using
 * `manifest-core/src/web/manifest-web.ts`:
 * - Reactive state signals & computed properties
 * - Keyed list reconciliation of product inventory
 * - Search query and category filter
 * - Dynamic metrics (Total products, total inventory value, average price)
 * - Add/Edit product modal with full form validation
 * - Scoped styling and dark theme matching Manifest Studio
 */

import {
  h,
  VNode,
  createState,
  computed,
  createScopedStyle,
  FormModel,
  FormField,
  Validators,
} from '../../manifest-core/src/web/manifest-web.ts';

export interface ProductItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  status: 'In Stock' | 'Low Stock' | 'Out of Stock';
}

const INITIAL_PRODUCTS: ProductItem[] = [
  {
    id: 'prod-1',
    sku: 'PROD-1001',
    name: 'Studio Monitor Headphones',
    category: 'Electronics',
    price: 149.0,
    stock: 42,
    status: 'In Stock',
  },
  {
    id: 'prod-2',
    sku: 'PROD-1002',
    name: 'Ergonomic Mechanical Keyboard',
    category: 'Electronics',
    price: 189.5,
    stock: 18,
    status: 'In Stock',
  },
  {
    id: 'prod-3',
    sku: 'PROD-1003',
    name: 'Merino Wool Everyday Hoodie',
    category: 'Apparel',
    price: 110.0,
    stock: 55,
    status: 'In Stock',
  },
  {
    id: 'prod-4',
    sku: 'PROD-1004',
    name: 'Ceramic Pour-Over Coffee Dripper',
    category: 'Home',
    price: 38.0,
    stock: 6,
    status: 'Low Stock',
  },
  {
    id: 'prod-5',
    sku: 'PROD-1005',
    name: 'Anodized Aluminum Desk Lamp',
    category: 'Home',
    price: 85.0,
    stock: 0,
    status: 'Out of Stock',
  },
];

export function createCommerceDashboard() {
  // Reactive State
  const products = createState<ProductItem[]>(INITIAL_PRODUCTS);
  const searchQuery = createState<string>('');
  const selectedCategory = createState<string>('all');
  const activeTab = createState<'overview' | 'products' | 'analytics'>('overview');
  const isModalOpen = createState<boolean>(false);

  // Form Validation Model for Adding Product
  const productForm = new FormModel({
    name: new FormField('', [Validators.required('Product name is required'), Validators.minLength(3, 'At least 3 characters')]),
    sku: new FormField('', [Validators.required('SKU is required'), Validators.pattern(/^PROD-\d{4}$/, 'Format must be PROD-XXXX')]),
    category: new FormField('Electronics', [Validators.required()]),
    price: new FormField('49.99', [Validators.required(), Validators.numeric('Must be a number'), Validators.min(1, 'Minimum price is $1.00')]),
    stock: new FormField('20', [Validators.required(), Validators.numeric('Must be an integer'), Validators.min(0, 'Cannot be negative')]),
  });

  // Computed Values
  const filteredProducts = computed(() => {
    const q = searchQuery.value.toLowerCase().trim();
    const cat = selectedCategory.value;
    return products.value.filter((p) => {
      const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      const matchesCategory = cat === 'all' || p.category === cat;
      return matchesSearch && matchesCategory;
    });
  });

  const totalInventoryValue = computed(() => {
    return products.value.reduce((acc, p) => acc + p.price * p.stock, 0);
  });

  const totalUnits = computed(() => {
    return products.value.reduce((acc, p) => acc + p.stock, 0);
  });

  // Scoped CSS Styles
  const dashboardClass = createScopedStyle(`
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: #181818;
    color: #cccccc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `, 'm-dash');

  const headerClass = createScopedStyle(`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    background: #1f1f1f;
    border-bottom: 1px solid #2d2d2d;
  `, 'm-head');

  const cardGridClass = createScopedStyle(`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  `, 'm-grid');

  const cardClass = createScopedStyle(`
    background: #222222;
    border: 1px solid #2d2d2d;
    border-radius: 6px;
    padding: 16px;
  `, 'm-card');

  // Actions
  const handleAddProduct = () => {
    if (!productForm.validateAll()) {
      return false;
    }
    const vals = productForm.getValues();
    const priceNum = parseFloat(vals.price);
    const stockNum = parseInt(vals.stock, 10);
    const newProd: ProductItem = {
      id: `prod-${Date.now()}`,
      sku: vals.sku.toUpperCase(),
      name: vals.name,
      category: vals.category,
      price: priceNum,
      stock: stockNum,
      status: stockNum > 10 ? 'In Stock' : stockNum > 0 ? 'Low Stock' : 'Out of Stock',
    };
    products.update((list) => [newProd, ...list]);
    productForm.reset({
      name: '',
      sku: '',
      category: 'Electronics',
      price: '49.99',
      stock: '20',
    });
    isModalOpen.value = false;
    return true;
  };

  const handleDeleteProduct = (id: string) => {
    products.update((list) => list.filter((p) => p.id !== id));
  };

  // Render Function
  return {
    state: {
      products,
      searchQuery,
      selectedCategory,
      activeTab,
      isModalOpen,
      productForm,
      filteredProducts,
      totalInventoryValue,
      totalUnits,
    },
    actions: {
      handleAddProduct,
      handleDeleteProduct,
    },
    render: (): VNode => {
      const items = filteredProducts.value;
      const totalValFormatted = `$${totalInventoryValue.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      return h('div', { className: dashboardClass },
        // Header
        h('header', { className: headerClass },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
            h('span', { style: { fontWeight: 'bold', fontSize: '16px', color: '#ffffff' } }, 'Manifest Commerce'),
            h('span', { style: { fontSize: '11px', background: '#094771', color: '#ffffff', padding: '2px 8px', borderRadius: '4px' } }, 'v1.0')
          ),
          h('div', { style: { display: 'flex', gap: '12px' } },
            h('button', {
              className: 'm-tab-btn',
              style: {
                background: activeTab.value === 'overview' ? '#37373d' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer'
              },
              onClick: () => { activeTab.value = 'overview'; }
            }, 'Dashboard'),
            h('button', {
              className: 'm-tab-btn',
              style: {
                background: activeTab.value === 'products' ? '#37373d' : 'transparent',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer'
              },
              onClick: () => { activeTab.value = 'products'; }
            }, 'Products')
          )
        ),

        // Main Body
        h('main', { style: { padding: '24px', flex: '1' } },
          // Metrics Row
          h('div', { className: cardGridClass },
            h('div', { className: cardClass },
              h('div', { style: { fontSize: '12px', color: '#888' } }, 'Total Products'),
              h('div', { id: 'metric-total-products', style: { fontSize: '24px', fontWeight: 'bold', color: '#fff', marginTop: '6px' } }, String(products.value.length)),
              h('div', { style: { fontSize: '11px', color: '#4ec9b0', marginTop: '4px' } }, '+3 this month')
            ),
            h('div', { className: cardClass },
              h('div', { style: { fontSize: '12px', color: '#888' } }, 'Total Inventory Value'),
              h('div', { id: 'metric-total-value', style: { fontSize: '24px', fontWeight: 'bold', color: '#fff', marginTop: '6px' } }, totalValFormatted),
              h('div', { style: { fontSize: '11px', color: '#4ec9b0', marginTop: '4px' } }, 'Real-time recalculated')
            ),
            h('div', { className: cardClass },
              h('div', { style: { fontSize: '12px', color: '#888' } }, 'Total Stock Units'),
              h('div', { id: 'metric-total-stock', style: { fontSize: '24px', fontWeight: 'bold', color: '#fff', marginTop: '6px' } }, String(totalUnits.value)),
              h('div', { style: { fontSize: '11px', color: '#dcdcaa', marginTop: '4px' } }, 'Across all categories')
            ),
            h('div', { className: cardClass },
              h('div', { style: { fontSize: '12px', color: '#888' } }, 'Return Rate'),
              h('div', { style: { fontSize: '24px', fontWeight: 'bold', color: '#fff', marginTop: '6px' } }, '1.2%'),
              h('div', { style: { fontSize: '11px', color: '#4ec9b0', marginTop: '4px' } }, '-0.3% vs last quarter')
            )
          ),

          // Catalog Toolbar
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' } },
            h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
              h('input', {
                id: 'input-search',
                type: 'text',
                placeholder: 'Search by SKU or Name...',
                value: searchQuery.value,
                style: {
                  background: '#252526',
                  border: '1px solid #3c3c3c',
                  color: '#fff',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  width: '240px'
                },
                onInput: (e: any) => { searchQuery.value = e.target.value; }
              }),
              h('select', {
                id: 'select-category',
                value: selectedCategory.value,
                style: {
                  background: '#252526',
                  border: '1px solid #3c3c3c',
                  color: '#fff',
                  padding: '6px 12px',
                  borderRadius: '4px'
                },
                onChange: (e: any) => { selectedCategory.value = e.target.value; }
              },
                h('option', { value: 'all' }, 'All Categories'),
                h('option', { value: 'Electronics' }, 'Electronics'),
                h('option', { value: 'Apparel' }, 'Apparel'),
                h('option', { value: 'Home' }, 'Home')
              )
            ),
            h('button', {
              id: 'btn-open-modal',
              style: {
                background: '#0e639c',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                fontWeight: '500',
                cursor: 'pointer'
              },
              onClick: () => { isModalOpen.value = true; }
            }, '+ Add Product')
          ),

          // Product Inventory Table
          h('div', { style: { background: '#1f1f1f', border: '1px solid #2d2d2d', borderRadius: '6px', overflow: 'hidden' } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' } },
              h('thead', {},
                h('tr', { style: { background: '#252526', borderBottom: '1px solid #2d2d2d', color: '#999' } },
                  h('th', { style: { padding: '10px 16px' } }, 'SKU'),
                  h('th', { style: { padding: '10px 16px' } }, 'Product Name'),
                  h('th', { style: { padding: '10px 16px' } }, 'Category'),
                  h('th', { style: { padding: '10px 16px' } }, 'Price'),
                  h('th', { style: { padding: '10px 16px' } }, 'Stock'),
                  h('th', { style: { padding: '10px 16px' } }, 'Status'),
                  h('th', { style: { padding: '10px 16px', textAlign: 'right' } }, 'Action')
                )
              ),
              h('tbody', { id: 'product-table-body' },
                ...items.map((prod) =>
                  h('tr', {
                    key: prod.id,
                    style: { borderBottom: '1px solid #282828' }
                  },
                    h('td', { style: { padding: '10px 16px', fontFamily: 'monospace', color: '#4ec9b0' } }, prod.sku),
                    h('td', { style: { padding: '10px 16px', fontWeight: '500', color: '#fff' } }, prod.name),
                    h('td', { style: { padding: '10px 16px', color: '#888' } }, prod.category),
                    h('td', { style: { padding: '10px 16px', color: '#dcdcaa' } }, `$${prod.price.toFixed(2)}`),
                    h('td', { style: { padding: '10px 16px' } }, `${prod.stock} units`),
                    h('td', { style: { padding: '10px 16px' } },
                      h('span', {
                        style: {
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: prod.status === 'In Stock' ? '#143c24' : prod.status === 'Low Stock' ? '#3c3214' : '#3c1414',
                          color: prod.status === 'In Stock' ? '#4ec9b0' : prod.status === 'Low Stock' ? '#ce9178' : '#f48771',
                        }
                      }, prod.status)
                    ),
                    h('td', { style: { padding: '10px 16px', textAlign: 'right' } },
                      h('button', {
                        style: { background: 'transparent', border: 'none', color: '#f48771', cursor: 'pointer', fontSize: '12px' },
                        onClick: () => handleDeleteProduct(prod.id)
                      }, 'Delete')
                    )
                  )
                )
              )
            )
          ),

          // Modal Form for Add Product
          isModalOpen.value
            ? h('div', {
                id: 'product-modal-backdrop',
                style: {
                  position: 'fixed',
                  top: '0',
                  left: '0',
                  right: '0',
                  bottom: '0',
                  background: 'rgba(0,0,0,0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: '1000'
                }
              },
                h('div', {
                  id: 'product-modal',
                  style: {
                    background: '#222222',
                    border: '1px solid #3c3c3c',
                    borderRadius: '8px',
                    width: '420px',
                    padding: '24px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
                  }
                },
                  h('h3', { style: { margin: '0 0 16px 0', color: '#fff', fontSize: '18px' } }, 'Add New Product'),
                  // Name Field
                  h('div', { style: { marginBottom: '12px' } },
                    h('label', { style: { display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' } }, 'Product Name'),
                    h('input', {
                      id: 'modal-input-name',
                      type: 'text',
                      value: productForm.fields.name.value.value,
                      style: { width: '100%', background: '#2d2d2d', border: '1px solid #444', color: '#fff', padding: '8px', borderRadius: '4px' },
                      onInput: (e: any) => { productForm.fields.name.value.value = e.target.value; }
                    }),
                    productForm.fields.name.error.value
                      ? h('div', { id: 'name-error', style: { color: '#f48771', fontSize: '11px', marginTop: '2px' } }, productForm.fields.name.error.value)
                      : null
                  ),
                  // SKU Field
                  h('div', { style: { marginBottom: '12px' } },
                    h('label', { style: { display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' } }, 'SKU (e.g. PROD-9999)'),
                    h('input', {
                      id: 'modal-input-sku',
                      type: 'text',
                      value: productForm.fields.sku.value.value,
                      style: { width: '100%', background: '#2d2d2d', border: '1px solid #444', color: '#fff', padding: '8px', borderRadius: '4px' },
                      onInput: (e: any) => { productForm.fields.sku.value.value = e.target.value; }
                    }),
                    productForm.fields.sku.error.value
                      ? h('div', { id: 'sku-error', style: { color: '#f48771', fontSize: '11px', marginTop: '2px' } }, productForm.fields.sku.error.value)
                      : null
                  ),
                  // Category Field
                  h('div', { style: { marginBottom: '12px' } },
                    h('label', { style: { display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' } }, 'Category'),
                    h('select', {
                      id: 'modal-select-cat',
                      value: productForm.fields.category.value.value,
                      style: { width: '100%', background: '#2d2d2d', border: '1px solid #444', color: '#fff', padding: '8px', borderRadius: '4px' },
                      onChange: (e: any) => { productForm.fields.category.value.value = e.target.value; }
                    },
                      h('option', { value: 'Electronics' }, 'Electronics'),
                      h('option', { value: 'Apparel' }, 'Apparel'),
                      h('option', { value: 'Home' }, 'Home')
                    )
                  ),
                  // Price and Stock
                  h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' } },
                    h('div', {},
                      h('label', { style: { display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' } }, 'Price ($)'),
                      h('input', {
                        id: 'modal-input-price',
                        type: 'number',
                        step: '0.01',
                        value: productForm.fields.price.value.value,
                        style: { width: '100%', background: '#2d2d2d', border: '1px solid #444', color: '#fff', padding: '8px', borderRadius: '4px' },
                        onInput: (e: any) => { productForm.fields.price.value.value = e.target.value; }
                      }),
                      productForm.fields.price.error.value
                        ? h('div', { id: 'price-error', style: { color: '#f48771', fontSize: '11px', marginTop: '2px' } }, productForm.fields.price.error.value)
                        : null
                    ),
                    h('div', {},
                      h('label', { style: { display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' } }, 'Stock Units'),
                      h('input', {
                        id: 'modal-input-stock',
                        type: 'number',
                        value: productForm.fields.stock.value.value,
                        style: { width: '100%', background: '#2d2d2d', border: '1px solid #444', color: '#fff', padding: '8px', borderRadius: '4px' },
                        onInput: (e: any) => { productForm.fields.stock.value.value = e.target.value; }
                      }),
                      productForm.fields.stock.error.value
                        ? h('div', { id: 'stock-error', style: { color: '#f48771', fontSize: '11px', marginTop: '2px' } }, productForm.fields.stock.error.value)
                        : null
                    )
                  ),
                  // Buttons
                  h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px' } },
                    h('button', {
                      id: 'modal-btn-cancel',
                      style: { background: 'transparent', border: '1px solid #444', color: '#ccc', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' },
                      onClick: () => { isModalOpen.value = false; }
                    }, 'Cancel'),
                    h('button', {
                      id: 'modal-btn-save',
                      style: { background: '#0e639c', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' },
                      onClick: handleAddProduct
                    }, 'Save Product')
                  )
                )
              )
            : null
        )
      );
    }
  };
}
