import { createClient } from '@supabase/supabase-js';

const supabaseUrl: string = 'https://qlrpeivzmdcvkevjoska.supabase.co';
const supabaseAnonKey: string = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFscnBlaXZ6bWRjdmtldmpvc2thIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1ODM1NjUsImV4cCI6MjA3NzE1OTU2NX0.r_fATb8QvYYf4cb9xqEL2bCQTukrdqK7Ue0BFzYEIrk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
