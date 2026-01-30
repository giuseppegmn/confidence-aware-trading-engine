import DemoPanel from './components/demo/DemoPanel';

export default function App() {
  return (
    <main className='max-w-3xl mx-auto p-8 space-y-6'>
      <h1 className='text-3xl font-bold'>
        CATE — Confidence-Aware Trading Engine
      </h1>

      <p className='text-gray-600'>
        CATE evaluates oracle uncertainty before allowing execution.
        This demo shows how risk-based gating works in practice.
      </p>

      <DemoPanel />
    </main>
  );
}
