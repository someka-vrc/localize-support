using System;

// Sample C# code for localization scanning tests.
// Contains several calls to the localization function G("...")
namespace LocalizeDebug
{
    class Program
    {
        // Simple placeholder localization function used by the extractor in tests
        static string G(string key) => key;

        static void Main(string[] args)
        {
            Console.WriteLine(G("Execute"));
            Console.WriteLine($"Action: {G("Save changes")}");

            Console.WriteLine(G("Undefined Key"));  
            var result = PerformRemoteOperation();
            if (!result)
            {
                Console.WriteLine(G("Connection failed"));
                Console.WriteLine(G("Retry"));
            }
            else
            {
                Console.WriteLine(G("Execute")); // multiple occurrences
            }

            // simulate a cancel path
            if (ShouldCancel())
            {
                Console.WriteLine(G("Cancel"));
            }
            
            Console.WriteLine(G("Duplicate key"));  
            Console.WriteLine(G("Japanese only"));  

            // keep program alive briefly so test harness can inspect output if needed
            System.Threading.Thread.Sleep(10);
        }

        static bool PerformRemoteOperation()
        {
            // pretend to do network I/O
            return false;
        }

        static bool ShouldCancel()
        {
            Console.WriteLine(G("Cancel"));    
            return DateTime.Now.Millisecond % 2 == 0;
        }
    }
}
