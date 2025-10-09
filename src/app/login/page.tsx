'use client';

import LoginPage from '@/components/LoginPage';

export default function Login() {
  const handleLogin = async (email: string, password: string) => {
    // Mock login for UI testing
    console.log('Login attempt:', { email, password });
    
    // Simulate login delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (email && password) {
      alert(`Login successful!\nEmail: ${email}\nPassword: ${password}`);
      // In a real app, you would redirect to the main page here
    } else {
      throw new Error('Please enter both email and password');
    }
  };

  const handleOfflineLogin = async () => {
    // Mock offline login for UI testing
    console.log('Offline login attempt');
    await new Promise(resolve => setTimeout(resolve, 500));
    alert('Offline login successful!');
  };

  const handleClose = () => {
    // Handle close action - exit the application
    console.log('Login closed');
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.closeWindow();
    }
  };

  return (
    <div className="w-full h-screen bg-gray-900">
      <LoginPage
        onLogin={handleLogin}
        onOfflineLogin={handleOfflineLogin}
        onClose={handleClose}
      />
    </div>
  );
}

