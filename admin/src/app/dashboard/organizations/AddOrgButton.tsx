'use client';

import { useState } from 'react';
import AddOrganizationModal from './AddOrganizationModal';

export default function AddOrgButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="retro-btn text-sm py-2 px-4"
      >
        + Add Workspace
      </button>

      {isOpen && (
        <AddOrganizationModal onClose={() => setIsOpen(false)} />
      )}
    </>
  );
}
