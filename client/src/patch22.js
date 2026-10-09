const fs = require('fs');
let content = fs.readFileSync('contexts/AuthContext.tsx', 'utf8');

// Add to context type
content = content.replace("  syncData: () => Promise<void>;", "  syncData: () => Promise<void>;\n  pushData: () => Promise<void>;");

// Add to default context value
content = content.replace("  syncData: async () => {},", "  syncData: async () => {},\n  pushData: async () => {},");

// Find syncData implementation and add pushData right after it
const pushDataImpl = `
  const pushData = useCallback(async (currentUser?: User | null) => {
    const activeUser = currentUser === undefined ? userRef.current : currentUser;
    if (!activeUser) return;

    try {
      const localLibRaw = localStorage.getItem("yomi.lib");
      const localContRaw = localStorage.getItem("yomi.continue");
      
      const localLib: any[] = localLibRaw ? JSON.parse(localLibRaw) : [];
      const localCont: any[] = localContRaw ? JSON.parse(localContRaw) : [];

      const { error: pushError } = await supabase.rpc('sync_user_data', {
        p_user_id: activeUser.id,
        p_library_data: localLib,
        p_continue_data: localCont
      });

      if (pushError) {
        console.error("Error pushing sync data:", pushError.message);
      }
    } catch (err) {
      console.error("pushData failed:", err);
    }
  }, []);
`;

// Insert pushData before clearAllData
content = content.replace("  const clearAllData = useCallback(async () => {", pushDataImpl + "\n  const clearAllData = useCallback(async () => {");

// Add pushData to dependencies of the provider return
content = content.replace("        syncData,", "        syncData,\n        pushData,");

fs.writeFileSync('contexts/AuthContext.tsx', content);
console.log('Patched AuthContext.tsx');
