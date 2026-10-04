import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function Toast({ message, type = 'info', onClose }: { message: string, type?: 'success'|'error'|'info', onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const config = {
    success: { bg: 'bg-[#2563eb]', border: 'border-[#3b82f6]', icon: <CheckCircle size={18} className="text-white" /> },
    error: { bg: 'bg-[#ef4444]', border: 'border-[#f87171]', icon: <AlertCircle size={18} className="text-white" /> },
    info: { bg: 'bg-[#0f172a]', border: 'border-[#1e293b]', icon: <Info size={18} className="text-[#60a5fa]" /> }
  };

  const current = config[type];

  return (
    <motion.div
       initial={{ opacity: 0, y: 50, scale: 0.9 }}
       animate={{ opacity: 1, y: 0, scale: 1 }}
       exit={{ opacity: 0, y: 20, scale: 0.9 }}
       transition={{ type: "spring", stiffness: 400, damping: 25 }}
       className={`fixed bottom-6 right-6 ${current.bg} border ${current.border} text-white px-5 py-4 rounded-xl shadow-2xl flex items-center gap-3 z-[100] backdrop-blur-md bg-opacity-90 min-w-[300px] max-w-md`}
    >
      <div className="flex-shrink-0">{current.icon}</div>
      <span className="text-sm font-medium flex-1 tracking-wide leading-relaxed">{message}</span>
      <button onClick={onClose} className="hover:opacity-70 transition-opacity ml-2 opacity-50"><X size={16} /></button>
    </motion.div>
  );
}

export function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-[#020617]/80 backdrop-blur-sm"
        />
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="bg-[#0f172a] border border-[#1e293b] rounded-2xl shadow-2xl w-full max-w-lg flex flex-col relative z-10 overflow-hidden"
        >
          <div className="flex items-center justify-between p-5 border-b border-[#1e293b] bg-[#020617]/30">
            <h3 className="text-xl font-bold text-[#e2e8f0] tracking-tight">{title}</h3>
            <button 
              onClick={onClose} 
              className="text-[#94a3b8] hover:text-[#e2e8f0] bg-[#1e293b]/50 hover:bg-[#1e293b] p-2 rounded-full transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <div className="p-6">
            {children}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
