export default function Home() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-lg text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">Marviano POS</h1>
        <p className="text-gray-600 mb-6">Welcome to the Point of Sale System</p>
        <div className="space-y-2">
          <p className="text-sm text-gray-500">This is the main POS interface.</p>
          <p className="text-sm text-gray-500">In a real app, this would show the POS dashboard.</p>
        </div>
      </div>
    </div>
  );
}