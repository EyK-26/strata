import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";

const DepartmentApps = () => {
    const { id } = useParams();
    const [payload, setPayload] = useState({ count: 0, data: [] });

    useEffect(() => {
        axios.get(`/api/departments/${id}/applications`).then((response) => {
            setPayload(response.data);
        });
    }, [id]);

    return (
        <div className="DepartmentApplications">
            <h2>Department applications</h2>
            <p>Count: {payload.count}</p>
            {payload.data.map((application) => (
                <Link
                    key={application.id}
                    className="list-item"
                    to={`/applications/${application.id}`}
                >
                    Application {application.id}
                </Link>
            ))}
        </div>
    );
};

export default DepartmentApps;
