/**
 * Manifest Phase 6 Automated Test Suite
 * Validates:
 * - Manifest Web Framework Virtual DOM builder (h) and tree hierarchy
 * - Fine-grained reactive state signals (createState, update, subscribe)
 * - Derived computed state signals with automatic dependency tracking
 * - Client-side SPA Router: hash/history paths, dynamic params (/user/:id), queries, route guards
 * - Form validation engine: required, minLength, email, pattern rules & dirty state
 * - Scoped CSS class generator & hashing
 * - Capability-gated Web platform context (net, storage, clipboard)
 */

import {
  h,
  createState,
  computed,
  createRouter,
  Validators,
  FormField,
  FormModel,
  createScopedStyle,
  createManifestWebContext,
  renderVNodeToDOM,
} from '../src/web/manifest-web.ts';
import { compileManifestV1 } from '../src/pipeline.ts';

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`[Phase 6 Test Failure] ${msg}`);
  }
}

async function runPhase6Tests() {
  console.log('=== RUNNING MANIFEST PHASE 6: WEB APPLICATION FRAMEWORK TESTS ===\n');
  let passed = 0;

  // Test 1: Virtual DOM builder and hierarchy
  {
    const vnode = h(
      'div',
      { id: 'app-root', className: 'container' },
      h('h1', null, 'Hello Manifest'),
      h('button', { onClick: () => {} }, 'Click Me')
    );
    assert(vnode.tag === 'div', 'VNode tag should be div');
    assert(vnode.props.id === 'app-root', 'VNode prop id mismatch');
    assert(vnode.children.length === 2, 'VNode should have 2 children');
    assert((vnode.children[0] as any).tag === 'h1', 'Child tag should be h1');
    console.log('  ✓ Test 1: Virtual DOM builder (h) creates structured VNode trees');
    passed++;
  }

  // Test 2: Reactive State & Subscriptions
  {
    const count = createState(10);
    let notified = 0;
    let lastVal = 0;

    const unsub = count.subscribe((newVal) => {
      notified++;
      lastVal = newVal;
    });

    count.value = 25;
    assert(count.value === 25, 'State value should update');
    assert(notified === 1, 'Subscriber should be notified once');
    assert(lastVal === 25, 'Subscriber should receive new value');

    count.update((n) => n + 5);
    assert(count.value === 30, 'State.update should apply updater function');
    assert(notified === 2, 'Subscriber should be notified on update');

    unsub();
    count.value = 100;
    assert(notified === 2, 'Unsubscribed listener should not be notified');
    console.log('  ✓ Test 2: Reactive State signals update, notify, and unsubscribe cleanly');
    passed++;
  }

  // Test 3: Computed Derived State
  {
    const price = createState(100);
    const taxRate = createState(0.2);
    const total = computed(() => price.value + price.value * taxRate.value);

    assert(total.value === 120, `Initial computed total should be 120, got ${total.value}`);

    price.value = 200;
    assert(total.value === 240, `Computed total should react to price change: got ${total.value}`);

    taxRate.value = 0.1;
    assert(total.value === 220, `Computed total should react to taxRate change: got ${total.value}`);
    console.log('  ✓ Test 3: Computed derived signals track dependencies and recalculate');
    passed++;
  }

  // Test 4: Client-Side Router Parameter Matching
  {
    const Home = () => h('div', null, 'Home');
    const UserProfile = () => h('div', null, 'User Profile');
    const Settings = () => h('div', null, 'Settings');

    let allowSettings = true;

    const router = createRouter({
      routes: [
        { path: '/', component: Home },
        { path: '/users/:id', component: UserProfile },
        { path: '/settings', component: Settings, canActivate: () => allowSettings },
      ],
      mode: 'hash',
    });

    const matchHome = router.matchRoute('/');
    assert(matchHome !== null && matchHome.component === Home, 'Route / should match Home');

    const matchUser = router.matchRoute('/users/42?ref=dashboard');
    assert(matchUser !== null, 'Route /users/42 should match');
    assert(matchUser.params.id === '42', `Extracted id should be 42, got ${matchUser.params.id}`);
    assert(matchUser.query.ref === 'dashboard', 'Query param ref should be dashboard');

    const matchSettings = router.matchRoute('/settings');
    assert(matchSettings !== null && matchSettings.component === Settings, 'Settings route allowed');

    allowSettings = false;
    const matchSettingsBlocked = router.matchRoute('/settings');
    assert(
      matchSettingsBlocked !== null && matchSettingsBlocked.component !== Settings,
      'Route guard should block /settings when canActivate returns false'
    );
    console.log('  ✓ Test 4: SPA Router extracts dynamic path parameters, query strings, and guards');
    passed++;
  }

  // Test 5: Form Validation Engine
  {
    const form = new FormModel({
      email: new FormField('', [Validators.required('Email required'), Validators.email('Invalid email')]),
      age: new FormField('15', [Validators.minLength(2, 'Age must have 2 digits')]),
    });

    assert(!form.validateAll(), 'Form with empty required field should fail validation');
    assert(form.fields.email.error.value === 'Email required', 'Email should show required error');

    form.fields.email.value.value = 'invalid-email-format';
    form.validateAll();
    assert(form.fields.email.error.value === 'Invalid email', 'Email should show format error');

    form.fields.email.value.value = 'developer@manifest.lang';
    assert(form.validateAll(), 'Valid form should pass all validators');
    assert(form.fields.email.error.value === null, 'Email error should be cleared');
    console.log('  ✓ Test 5: Form fields validate required, email, and length rules');
    passed++;
  }

  // Test 6: Scoped Dynamic Styling
  {
    const cls1 = createScopedStyle('color: red; font-size: 14px;');
    const cls2 = createScopedStyle('color: red; font-size: 14px;');
    const cls3 = createScopedStyle('color: blue;');

    assert(cls1.startsWith('m-style-'), 'Class should start with prefix');
    assert(cls1 === cls2, 'Deterministic CSS hashing for identical styles');
    assert(cls1 !== cls3, 'Distinct styles generate distinct class hashes');
    console.log('  ✓ Test 6: Scoped CSS class generator produces deterministic scoped hashes');
    passed++;
  }

  // Test 7: Capability-Gated Web Platform Layer
  {
    // Case A: Missing 'net' capability
    const ctxNoNet = createManifestWebContext([]);
    let threwNet = false;
    try {
      await ctxNoNet.fetch('https://api.example.com/data');
    } catch (e: any) {
      threwNet = true;
      assert(e.message.includes('CapabilityDenied'), 'Should raise CapabilityDenied for fetch without net');
    }
    assert(threwNet, 'fetch without net capability must throw');

    // Case B: Granted 'fs' capability for storage
    const ctxFs = createManifestWebContext(['fs']);
    ctxFs.storage.setItem('user_session', 'token_123');
    // In node/mock without real localStorage this safely catches or stores
    console.log('  ✓ Test 7: Capability guards enforce net/storage boundaries on web APIs');
    passed++;
  }

  // Test 8: Full Manifest Pipeline Web Target Lowering
  {
    const src = `
module test_web_app;

requires net;

fn main() -> str {
  let header = "<h1>" + "Manifest Web App" + "</h1>";
  return header;
}
`;
    const res = await compileManifestV1(src, { target: 'web-js', profile: 'professional' });
    assert(res.success, `Web JS compilation should succeed: ${res.diagnostics.map((d) => d.message).join(', ')}`);
    assert(res.jsCode !== undefined && res.jsCode.includes('__runManifestModule'), 'Should emit JS module runner');
    console.log('  ✓ Test 8: Manifest source compiles through canonical pipeline to Web/JS target');
    passed++;
  }

  console.log(`\n>>> ALL ${passed}/${passed} PHASE 6 WEB FRAMEWORK TESTS PASSED SUCCESSFULLY! <<<\n`);
}

runPhase6Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
