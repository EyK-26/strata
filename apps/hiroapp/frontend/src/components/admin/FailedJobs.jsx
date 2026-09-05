import React, { useEffect, useState } from "react";
import axios from "axios";

const FailedJobs = () => {
    const [jobs, setJobs] = useState([]);

    const load = async () => {
        const response = await axios.get("/api/failed-jobs");
        setJobs(response.data);
    };

    useEffect(() => {
        load();
    }, []);

    const retry = async (id) => {
        await axios.post(`/api/failed-jobs/${id}/retry`);
        await load();
    };

    return (
        <div className="FailedJobs">
            <h2>Failed jobs</h2>
            {jobs.map((job) => (
                <div key={job.id} className="stack-row">
                    <p>{job.job_name}</p>
                    <pre>{job.exception}</pre>
                    <button type="button" onClick={() => retry(job.id)}>
                        Retry
                    </button>
                </div>
            ))}
            {jobs.length === 0 && <p>No failed jobs.</p>}
        </div>
    );
};

export default FailedJobs;
