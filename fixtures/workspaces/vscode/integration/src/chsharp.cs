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
            Console.WriteLine(G("Execute"));                // 1
            Console.WriteLine($"Action: {G("Save changes")}"); // 2

            var result = PerformRemoteOperation();
            if (!result)
            {
                Console.WriteLine(G("Connection failed"));   // 3
                Console.WriteLine(G("Retry"));               // 4
            }
            else
            {
                Console.WriteLine(G("Execute"));            // 5 (repeat to ensure multiple occurrences)
            }

            // simulate a cancel path
            if (ShouldCancel())
            {
                Console.WriteLine(G("Cancel"));              // 6
            }
            
            Console.WriteLine(G("Undefined Key"));

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
            return DateTime.Now.Millisecond % 2 == 0;
        }
    }
}
