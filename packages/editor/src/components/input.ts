import { create } from 'zustand';

/** Trạng thái phím bổ trợ dùng chung cho camera & thao tác dựng. */
interface InputState {
  rotate: boolean; // Space/Alt: xoay camera bằng chuột trái
  pan: boolean; // Shift: pan bằng chuột trái
  erase: boolean; // X: tạm chuyển sang xóa
  pick: boolean; // C: hút màu từ khối (eyedropper)
  setFlag: (k: 'rotate' | 'pan' | 'erase' | 'pick', v: boolean) => void;
}

export const useInput = create<InputState>((set) => ({
  rotate: false,
  pan: false,
  erase: false,
  pick: false,
  setFlag: (k, v) => set((s) => (s[k] === v ? s : ({ [k]: v } as Partial<InputState>))),
}));
