import axios from "axios";
import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Context from "../../context/Context";

const CreatePosition = () => {
    const navigate = useNavigate();
    const { state } = useContext(Context);
    const [positions, setPositions] = useState(null);
    const [values, setValues] = useState({
        name: "",
        description: "",
        start_date: "",
        end_date: "",
        pay_grade: "",
        department_id: state.user?.position?.department.id,
    });

    const fetchPositions = async () => {
        try {
            const response = await axios.get("/api/positions/all");
            setPositions(response.data);
        } catch (error) {
            console.log(error.response.data);
        }
    };

    const handleChange = (ev) => {
        setValues((previous_values) => {
            return {
                ...previous_values,
                [ev.target.name]: ev.target.value,
            };
        });
    };

    const handleSubmit = async (ev) => {
        ev.preventDefault();
        try {
            const response = await axios.post("/api/positions", values);
            navigate("/positions/" + response.data.id);
        } catch (error) {
            console.log(error);
        }
    };

    useEffect(() => {
        fetchPositions();
    }, []);

    return (
        <div className="CreatePosition">
            <h2>Create new position</h2>
            <button onClick={() => navigate(-1)}>back</button>
            <form action="/" method="post" onSubmit={handleSubmit}>
                <label>
                    Name:
                    <select
                        name="name"
                        onChange={handleChange}
                        value={values.name}
                        required
                    >
                        <option value="" disabled>
                            Select the position
                        </option>
                        {positions
                            ? positions.map((position, index) => (
                                  <option
                                      key={position.name}
                                      value={position.name}
                                  >
                                      {position.name}
                                  </option>
                              ))
                            : "Loading positions..."}
                    </select>
                </label>

                <label>
                    Description:
                    <textarea
                        name="description"
                        value={values.description}
                        onChange={handleChange}
                    />
                </label>

                <label>
                    Start date:
                    <input
                        type="date"
                        name="start_date"
                        value={values.start_date}
                        onChange={handleChange}
                    />
                </label>

                <label>
                    End date:
                    <input
                        type="date"
                        name="end_date"
                        value={values.end_date}
                        onChange={handleChange}
                    />
                </label>

                <label>
                    Pay grade:
                    <select
                        name="pay_grade"
                        onChange={handleChange}
                        value={values.pay_grade}
                        required
                    >
                        <option value="" disabled>
                            Select the pay grade
                        </option>
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                    </select>
                </label>

                <button>Create</button>
            </form>
        </div>
    );
};

export default CreatePosition;
