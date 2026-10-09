const fs = require('fs');
let content = fs.readFileSync('src/contexts/AuthContext.tsx', 'utf8');

const pushDataImpl = `
  const pushData = useCallback(async (currentUser?: User | null) => {
    const activeUser = currentUser === undefined ? userRef.current : currentUser;
    if (!activeUser) return;

    try {
      const localLibRaw = localStorage.getItem("yomi.lib");
      const localContRaw = localStorage.getItem("yomi.continue");
      
      const localLib = localLibRaw ? JSON.parse(localLibRaw) : [];
      const localCont = localContRaw ? JSON.parse(localContRaw) : [];

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

content = content.replace("  const clearAllData = async () => {", pushDataImpl + "\n  const clearAllData = async () => {");
fs.writeFileSync('src/contexts/AuthContext.tsx', content);
console.log('Injected pushData correctly');
