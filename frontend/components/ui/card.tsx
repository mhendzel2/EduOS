import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
}

export default function Card({ title, description, children, className, ...props }: CardProps) {
  return (
    <div
      className={twMerge(
        clsx('rounded-xl border border-slate-800 bg-slate-900 p-6', className)
      )}
      {...props}
    >
      {(title || description) && (
        <div className="mb-4">
          {title && <h3 className="text-lg font-semibold text-white">{title}</h3>}
          {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}
